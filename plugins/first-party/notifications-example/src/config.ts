import { z } from 'zod';

/**
 * Configuração NÃO sensível do plugin, por empresa.
 *
 * A URL de destino fica aqui; o segredo que assina as entregas vai cifrado no
 * cofre da plataforma (`requiredSecrets`), nunca em configuração legível.
 */
export const configuracaoDeNotificacoes = z.object({
  webhookUrl: z.url().max(2048),
});

export type ConfiguracaoDeNotificacoes = z.infer<
  typeof configuracaoDeNotificacoes
>;
