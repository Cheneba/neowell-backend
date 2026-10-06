import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { WebhookReceiver } from 'livekit-server-sdk';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../common/decorators/public.decorator';
import { Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConsultationsService } from './consultations.service';

/** Normalised payment provider event (docs/05 W1). */
interface PaymentEvent {
  reference: string;
  status: 'SUCCESSFUL' | 'FAILED';
  reason?: string;
}

@ApiTags('webhooks')
@Public()
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly paymentsSecret: string;
  private readonly livekit?: WebhookReceiver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consultations: ConsultationsService,
    config: ConfigService<Env, true>,
  ) {
    this.paymentsSecret = config.get('PAYMENTS_WEBHOOK_SECRET', { infer: true });
    const key = config.get('LIVEKIT_API_KEY', { infer: true });
    const secret = config.get('LIVEKIT_API_SECRET', { infer: true });
    if (key && secret) this.livekit = new WebhookReceiver(key, secret);
  }

  /** W1: payment results. Signature = hex HMAC-SHA256 of the raw body. */
  @Post('payments/:provider')
  @HttpCode(HttpStatus.OK)
  async payments(
    @Param('provider') provider: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: PaymentEvent,
    @Headers('x-neowell-signature') signature?: string,
  ) {
    if (!body?.reference || !['SUCCESSFUL', 'FAILED'].includes(body.status))
      throw new BadRequestException('Invalid event');
    const valid = this.verifyHmac(req.rawBody, signature);
    // Unsigned events get their own id so they can never block the genuine delivery.
    const externalId = valid ? body.reference : `invalid:${body.reference}:${Date.now()}`;
    const event = await this.store(`payments:${provider.toUpperCase()}`, externalId, valid, body);
    if (!event || !valid) return { received: true };
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { externalRef: body.reference },
      });
      if (payment)
        await this.consultations.applyPaymentResult(payment.id, body.status, body.reason);
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), error: payment ? null : 'Unknown reference' },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Payment webhook ${event.id} failed: ${message}`);
      await this.prisma.webhookEvent.update({ where: { id: event.id }, data: { error: message } });
    }
    return { received: true };
  }

  /** W2: LiveKit room events. */
  @Post('livekit')
  @HttpCode(HttpStatus.OK)
  async livekitEvent(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('authorization') auth?: string,
  ) {
    if (!this.livekit || !req.rawBody) return { received: true };
    let event;
    try {
      event = await this.livekit.receive(req.rawBody.toString('utf8'), auth);
    } catch {
      await this.store('livekit', `invalid-${Date.now()}`, false, {});
      return { received: true };
    }
    const stored = await this.store(
      'livekit',
      event.id,
      true,
      JSON.parse(req.rawBody.toString('utf8')),
    );
    if (!stored) return { received: true };
    const room = event.room?.name;
    const c = room
      ? await this.prisma.consultation.findUnique({
          where: { roomName: room },
          include: { clinician: true },
        })
      : null;
    if (c) {
      if (
        event.event === 'participant_joined' &&
        event.participant?.identity === c.clinician.userId &&
        c.status === 'CONFIRMED'
      ) {
        await this.prisma.consultation.updateMany({
          where: { id: c.id, status: 'CONFIRMED' },
          data: { status: 'IN_PROGRESS', startedAt: new Date() },
        });
      }
      if (event.event === 'room_finished' && !c.endedAt) {
        await this.prisma.consultation.update({
          where: { id: c.id },
          data: { endedAt: new Date() },
        });
      }
    }
    await this.prisma.webhookEvent.update({
      where: { id: stored.id },
      data: { processedAt: new Date() },
    });
    return { received: true };
  }

  private verifyHmac(raw: Buffer | undefined, signature?: string): boolean {
    if (!raw || !signature) return false;
    const expected = Buffer.from(
      createHmac('sha256', this.paymentsSecret).update(raw).digest('hex'),
    );
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Stores the event; returns null for a duplicate delivery. */
  private async store(
    source: string,
    externalId: string,
    signatureValid: boolean,
    payload: unknown,
  ) {
    try {
      return await this.prisma.webhookEvent.create({
        data: { source, externalId, signatureValid, payload: payload as Prisma.InputJsonValue },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }
}
