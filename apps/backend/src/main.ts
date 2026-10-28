import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  app.enableShutdownHooks();
  setupApp(app);
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`API IvoireCovoit démarrée sur le port ${env.PORT} (${env.NODE_ENV})`);
}

bootstrap().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
