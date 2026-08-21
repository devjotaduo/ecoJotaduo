import { createDatabase, runMigrations } from '@ecojotaduo/database';
import type { DatabaseHandle } from '@ecojotaduo/database';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  prepararBancoDeTestes,
  semearTenant,
  temBancoDeTeste,
  urlDaAplicacao,
  type TenantSemeado,
} from '@ecojotaduo/test-support';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DrizzleRefreshTokenRepository } from '../src/adapters/persistence/repositories';
import {
  RefreshTokenInvalidError,
  RefreshTokenUseCase,
} from '../src/application/refresh-token.use-case';
import type {
  RefreshTokenRepository,
  SecretHasher,
} from '../src/ports/repositories';

exigirBancoEmCI();

/**
 * Rotação de refresh token sob concorrência.
 *
 * O dublê em memória não consegue provar isto: a corrida só existe quando duas
 * chamadas disputam a MESMA linha, e quem decide o vencedor é o `UPDATE ...
 * where revoked_at is null` do PostgreSQL. Antes desta fase a sequência era
 * ler → emitir → revogar, e duas renovações simultâneas com o mesmo token
 * saíam ambas com um token válido — a detecção de reuso nunca disparava.
 */
describe.skipIf(!temBancoDeTeste)(
  'rotação de refresh token (concorrência)',
  () => {
    let dono: postgres.Sql;
    let encerrarBanco: (() => Promise<void>) | undefined;
    let handle: DatabaseHandle;
    let empresa: TenantSemeado;
    let caso: RefreshTokenUseCase;
    let repositorio: DrizzleRefreshTokenRepository;

    const hasher: SecretHasher = {
      hash: (segredo) => `h:${segredo}`,
      matches: (segredo, hash) => `h:${segredo}` === hash,
    };

    beforeAll(async () => {
      encerrarBanco = await prepararBancoDeTestes();
      dono = conexaoDoDono();
      await runMigrations(dono, migracoesDaPlataforma());
      handle = createDatabase({ url: urlDaAplicacao(), quiet: true });
    });

    afterAll(async () => {
      await handle.close();
      await dono.end({ timeout: 5 });
      await encerrarBanco?.();
    });

    beforeEach(async () => {
      await limparDados(dono);
      empresa = await semearTenant(dono, {
        slug: 'empresa-a',
        email: 'ana@empresa-a.com.br',
      });

      let sequencia = 0;
      repositorio = new DrizzleRefreshTokenRepository(handle.db);
      caso = new RefreshTokenUseCase(
        repositorio,
        hasher,
        { create: () => `token-${(sequencia += 1)}` },
        30,
      );
    });

    async function emitir() {
      return caso.issue({ userId: empresa.userId, tenantId: empresa.tenantId });
    }

    const contarValidos = async () => {
      const [linha] = await dono<{ total: number }[]>`
      select count(*)::int as total from identity_refresh_tokens
      where user_id = ${empresa.userId} and revoked_at is null
    `;
      return linha?.total ?? 0;
    };

    /**
     * Duas rotações que leem a MESMA linha antes de qualquer escrita.
     *
     * Deixar ao acaso não serve: o pool de conexões costuma serializar as duas
     * chamadas, e aí a segunda já encontra o token revogado e cai no caminho
     * antigo de reuso — o teste passaria mesmo com a corrida aberta. A barreira
     * abaixo segura as duas leituras até ambas terem acontecido, que é a
     * situação exata em que a versão anterior emitia dois tokens válidos.
     */
    function repositorioComCorrida(): RefreshTokenRepository {
      let leram = 0;
      let liberar!: () => void;
      const ambasLeram = new Promise<void>((resolve) => {
        liberar = resolve;
      });

      return {
        save: (entrada) => repositorio.save(entrada),
        findByHash: async (hash) => {
          const registro = await repositorio.findByHash(hash);
          leram += 1;
          if (leram >= 2) {
            liberar();
          }
          await ambasLeram;
          return registro;
        },
        revoke: (id, substituto) => repositorio.revoke(id, substituto),
        revokeAllOfUser: (userId) => repositorio.revokeAllOfUser(userId),
      };
    }

    it('duas rotações que leem juntas: uma vence, a outra é reuso', async () => {
      const original = await emitir();
      const emCorrida = new RefreshTokenUseCase(
        repositorioComCorrida(),
        hasher,
        { create: () => `corrida-${Math.random().toString(36).slice(2)}` },
        30,
      );

      const [a, b] = await Promise.allSettled([
        emCorrida.rotate(original.token),
        emCorrida.rotate(original.token),
      ]);

      const vencedoras = [a, b].filter((r) => r.status === 'fulfilled');
      const perdedoras = [a, b].filter((r) => r.status === 'rejected');

      expect(vencedoras).toHaveLength(1);
      expect(perdedoras).toHaveLength(1);
      expect((perdedoras[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        RefreshTokenInvalidError,
      );

      // A propriedade que a correção compra: a corrida NUNCA produz dois
      // tokens válidos a partir de um. Antes, produzia — e a detecção de reuso
      // nunca chegava a disparar.
      expect(await contarValidos()).toBeLessThanOrEqual(1);

      // O token apresentado morre nos dois caminhos.
      await expect(caso.rotate(original.token)).rejects.toThrow(
        RefreshTokenInvalidError,
      );

      // Resíduo conhecido: se a revogação da família da perdedora chegar ANTES
      // da gravação da vencedora, o token novo escapa. Fechar isso exige
      // serializar criação e revogação por família — registrado no roadmap.
    });

    it('a rotação normal deixa exatamente um token válido', async () => {
      const original = await emitir();
      const rotacionado = await caso.rotate(original.token);

      expect(rotacionado.refresh.token).not.toBe(original.token);
      expect(await contarValidos()).toBe(1);
    });

    it('falha fechada: revoga antes de emitir', async () => {
      const original = await emitir();
      // A gravação do novo token quebra DEPOIS da revogação do antigo.
      const quebrado = new RefreshTokenUseCase(
        {
          save: () => Promise.reject(new Error('banco caiu')),
          findByHash: (hash) => repositorio.findByHash(hash),
          revoke: (id, substituto) => repositorio.revoke(id, substituto),
          revokeAllOfUser: (userId) => repositorio.revokeAllOfUser(userId),
        },
        hasher,
        { create: () => 'nunca-gravado' },
        30,
      );

      await expect(quebrado.rotate(original.token)).rejects.toThrow(
        'banco caiu',
      );

      // O antigo não sobrevive à tentativa: o usuário refaz o login, em vez de
      // ficar com dois tokens válidos circulando.
      expect(await contarValidos()).toBe(0);
      await expect(caso.rotate(original.token)).rejects.toThrow(
        RefreshTokenInvalidError,
      );
    });

    it('reuso de token já rotacionado derruba a família', async () => {
      const original = await emitir();
      const outro = await emitir();
      await caso.rotate(original.token);
      expect(await contarValidos()).toBe(2);

      await expect(caso.rotate(original.token)).rejects.toThrow(
        RefreshTokenInvalidError,
      );

      // Inclusive o token que nada tinha a ver com a rotação: um vazamento
      // confirmado invalida a sessão inteira, não só o token apresentado.
      expect(await contarValidos()).toBe(0);
      await expect(caso.rotate(outro.token)).rejects.toThrow(
        RefreshTokenInvalidError,
      );
    });
  },
);
