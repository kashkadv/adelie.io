import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { config } from './config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Better Auth needs the raw body; the auth module re-adds parsers for other routes.
    bodyParser: false,
  });
  app.enableCors({ origin: config.webUrl, credentials: true });
  app.enableShutdownHooks();
  await app.listen(config.port);
}
await bootstrap();
