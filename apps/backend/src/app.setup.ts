import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { requestId } from './common/request-id.middleware';
import { ENV, type Env } from './config/env';

/** Configuration HTTP partagée entre main.ts et les tests d'intégration. */
export function setupApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  if (env.TRUST_PROXY > 0) {
    (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set('trust proxy', env.TRUST_PROXY);
  }
  app.use(requestId);
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());

  if (env.SWAGGER_ENABLED && env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('IvoireCovoit API')
      .setDescription('API REST de la plateforme IvoireCovoit. Montants en XOF entiers, dates en UTC.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
}
