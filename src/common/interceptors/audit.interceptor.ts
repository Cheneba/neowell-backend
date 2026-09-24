import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth-user';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records every successful state-changing request in `AuditLog` (PDR §5: "all inputs
 * timestamped and auditable"). Request bodies are deliberately not stored — they may
 * contain PHI, which already lives in the domain tables.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!MUTATING.has(req.method)) return next.handle();

    return next.handle().pipe(
      tap((body) => {
        const res = context.switchToHttp().getResponse<Response>();
        const routePath: string = req.route?.path ?? req.path;
        const entityId =
          (body && typeof body === 'object' && 'id' in body && typeof body.id === 'string'
            ? body.id
            : undefined) ?? firstParam(req.params?.id);
        this.prisma.auditLog
          .create({
            data: {
              userId: req.user?.id,
              action: `${req.method} ${routePath}`,
              entityType: context.getClass().name.replace(/Controller$/, ''),
              entityId,
              statusCode: res.statusCode,
              ip: req.ip,
            },
          })
          .catch((err: unknown) => this.logger.error('Failed to write audit log', err as Error));
      }),
    );
  }
}

const firstParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
