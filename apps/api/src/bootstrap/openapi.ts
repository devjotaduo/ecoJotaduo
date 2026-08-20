import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

export const VERSAO_DA_API = '1.0.0';

/**
 * Monta o documento OpenAPI a partir das rotas registradas.
 *
 * OpenAPI **3.1**: o dialeto de schema dele é o JSON Schema 2020-12 que o
 * `z.toJSONSchema` produz, então o contrato publicado é derivado dos mesmos
 * schemas que validam a entrada — sem tradução no meio (ver ADR-0008).
 */
export function construirDocumentoOpenApi(
  app: INestApplication,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setOpenAPIVersion('3.1.0')
    .setTitle('ecoJotaduo API')
    .setDescription(
      'ERP modular multi-tenant. Toda rota autenticada opera no tenant do ' +
        'token — não existe parâmetro de empresa. Erros seguem Problem ' +
        'Details (RFC 9457).',
    )
    .setVersion(VERSAO_DA_API)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token obtido em POST /api/v1/auth/login (usuário) ou ' +
          'POST /api/v1/auth/token (aplicação).',
      },
      'bearer',
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    // operationId vem do @ApiOperation de cada rota: é ele que nomeia os
    // métodos do SDK, então precisa ser estável entre versões.
    ignoreGlobalPrefix: false,
  });
}
