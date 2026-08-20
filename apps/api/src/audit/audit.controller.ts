import type { AuditLogger } from '@movimentar/audit';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';

import { AUDIT_LOGGER } from '../bootstrap/tokens';
import { RequirePermissions } from '../http/decorators';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const consultaSchema = z.object({
  action: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Consulta da trilha de auditoria da própria empresa (RLS garante o escopo). */
@Controller('api/v1/audit-events')
export class AuditController {
  constructor(@Inject(AUDIT_LOGGER) private readonly audit: AuditLogger) {}

  @Get()
  @RequirePermissions('platform.audit.read')
  async list(
    @Query(new ZodValidationPipe(consultaSchema))
    consulta: z.infer<typeof consultaSchema>,
  ) {
    const { items, total } = await this.audit.list(consulta);
    return {
      items: items.map((item) => ({
        ...item,
        occurredAt: item.occurredAt.toISOString(),
      })),
      total,
      limit: consulta.limit,
      offset: consulta.offset,
    };
  }
}
