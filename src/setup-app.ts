import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { Env } from './config/env';

/** Shared HTTP setup for `main.ts` and the e2e tests. */
export function setupApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const origins = config.get('CORS_ORIGINS', { infer: true });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // One line per request: method, path (no query string, it can carry tokens), status, time.
  if (config.get('NODE_ENV', { infer: true }) !== 'test') {
    const http = new Logger('HTTP');
    app.use((req: Request, res: Response, next: () => void) => {
      const started = Date.now();
      res.on('finish', () => {
        const path = req.originalUrl.split('?')[0];
        http.log(`${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`);
      });
      next();
    });
  }
  app.enableCors({
    origin: origins === '*' ? true : origins.split(',').map((o) => o.trim()),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
}
