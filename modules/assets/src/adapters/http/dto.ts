import { z } from 'zod';

import { MOTIVOS_DE_BLOQUEIO } from '../../domain/hold';

/** Schemas de borda de Ativos, compartilhados por REST e MCP. */

const motivo = z
  .enum(MOTIVOS_DE_BLOQUEIO)
  .describe(
    'maintenance = manutenção, reserved = reservado para operação, ' +
      'damaged = avariado, transit = em deslocamento',
  );

export const cadastrarAtivoSchema = z.object({
  /** Patrimônio. Único na empresa — é como o ativo é chamado no pátio. */
  code: z.string().min(1).max(60),
  name: z.string().min(2).max(200),
  category: z.string().min(2).max(80),
  serialNumber: z.string().max(120).nullish(),
  acquiredOn: z.iso.datetime().nullish(),
  notes: z.string().max(5000).nullish(),
});

export const atualizarAtivoSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  category: z.string().min(2).max(80).optional(),
  serialNumber: z.string().max(120).nullish(),
  acquiredOn: z.iso.datetime().nullish(),
  notes: z.string().max(5000).nullish(),
});

export const baixarAtivoSchema = z.object({
  reason: z.string().max(2000).nullish(),
});

export const bloquearSchema = z.object({
  assetId: z.uuid(),
  reason: motivo,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  notes: z.string().max(2000).nullish(),
});

export const pesquisarAtivosSchema = z.object({
  category: z.string().max(80).optional(),
  /** `available`/`held` saem dos bloqueios do momento, nunca de coluna. */
  availability: z.enum(['available', 'held', 'retired']).optional(),
  termo: z.string().max(120).optional(),
  /** Instante de referência da disponibilidade. Padrão: agora. */
  em: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const consultarDisponibilidadeSchema = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});
