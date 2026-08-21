import { assetsManifest } from '@ecojotaduo/assets';
import { commercialManifest } from '@ecojotaduo/commercial';
import { contractsManifest } from '@ecojotaduo/contracts';
import { crmManifest } from '@ecojotaduo/crm';
import { pluginsManifest } from '@ecojotaduo/plugins';
import { identityManifest } from '@ecojotaduo/identity';
import {
  resolveModules,
  type ResolvedModules,
} from '@ecojotaduo/platform-kernel';
import { tenancyManifest } from '@ecojotaduo/tenancy';

/**
 * Módulos internos confiáveis desta instalação.
 *
 * O registro é explícito, em tempo de bootstrap — nada de descobrir e executar
 * código arbitrário (ver docs/adr/0005-plugin-isolation.md). O kernel valida
 * dependências, detecta ciclos e devolve a ordem de carga e de migração.
 */
export const modulosInstalados = [
  identityManifest,
  tenancyManifest,
  pluginsManifest,
  crmManifest,
  commercialManifest,
  contractsManifest,
  assetsManifest,
];

export function catalogoDeModulos(): ResolvedModules {
  return resolveModules(modulosInstalados);
}
