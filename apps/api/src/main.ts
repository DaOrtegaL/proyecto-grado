import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

/** Carga el archivo .env de la raíz del monorepositorio si existe (en Docker las variables ya vienen definidas). */
function loadDotenv(): void {
  const file = resolve(__dirname, '../../../.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export async function createApp(): Promise<NestExpressApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false, rawBody: true });
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.disable('x-powered-by');
  return app;
}

async function bootstrap(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const app = await createApp();

  const config = new DocumentBuilder()
    .setTitle('MSH-CLM — API de gestión del ciclo de vida de certificados')
    .setDescription('API REST del prototipo MSH-CLM (proyecto de grado UNAD).')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  await app.listen(env.API_PORT);
  new Logger('Arranque').log(`API disponible en el puerto ${env.API_PORT} (modo ${env.EXECUTION_MODE})`);
}

if (require.main === module) {
  bootstrap().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
