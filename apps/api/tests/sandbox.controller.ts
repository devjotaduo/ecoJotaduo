import { Controller, Get } from '@nestjs/common';

import { RequirePermissions } from '../src/http/decorators';

/**
 * Rota existente APENAS nos testes.
 *
 * A Fase 2 ainda não tem módulo de negócio, mas o guard precisa ser exercitado
 * ponta a ponta contra uma permissão cujo módulo pode ser contratado e
 * cancelado. Na Fase 3 o CRM assume esse papel e este controller sai.
 */
@Controller('api/v1/sandbox')
export class SandboxController {
  @Get('tenancy')
  @RequirePermissions('tenancy.demo.read')
  demo() {
    return { ok: true };
  }
}
