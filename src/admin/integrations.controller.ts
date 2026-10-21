import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CallProvider } from '../consultations/call-provider';
import { Role } from '../generated/prisma/enums';
import { EmailService } from '../notifications/email.service';
import { PushService } from '../notifications/push.service';
import { SmsService } from '../notifications/sms.service';
import { PaymentGateway } from '../payments/payment-gateway';
import { PrismaService } from '../prisma/prisma.service';
import { Realtime } from '../realtime/realtime.service';
import { StorageService } from '../storage/storage.service';
import { SpeechToText } from '../voice/speech-to-text';

class IntegrationTestDto {
  @IsIn(['sms', 'email', 'push', 'realtime', 'storage']) channel: string;
  /** Phone (sms) or address (email). Push and realtime go to the calling admin. */
  @IsOptional() @IsString() @Length(3, 200) to?: string;
}

/** Shows which third-party driver is active and fires test messages, for live setup. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/integrations')
export class IntegrationsController {
  constructor(
    private readonly sms: SmsService,
    private readonly email: EmailService,
    private readonly push: PushService,
    private readonly storage: StorageService,
    private readonly payments: PaymentGateway,
    private readonly calls: CallProvider,
    private readonly stt: SpeechToText,
    private readonly realtime: Realtime,
    private readonly prisma: PrismaService,
  ) {}

  /** Active driver per port. Never includes credentials. */
  @Get()
  status() {
    return {
      sms: this.sms.constructor.name,
      email: this.email.constructor.name,
      push: this.push.constructor.name,
      storage: this.storage.constructor.name,
      payments: this.payments.constructor.name,
      calls: this.calls.constructor.name,
      speechToText: this.stt.constructor.name,
    };
  }

  @Post('test')
  async test(@CurrentUser() admin: AuthUser, @Body() dto: IntegrationTestDto) {
    try {
      switch (dto.channel) {
        case 'sms': {
          if (!dto.to) throw new BadRequestException('"to" (phone) is required');
          await this.sms.send(dto.to, 'NeoWell test message');
          return { ok: true, driver: this.sms.constructor.name };
        }
        case 'email': {
          if (!dto.to || !/^\S+@\S+\.\S+$/.test(dto.to))
            throw new BadRequestException('"to" (email) is required');
          await this.email.send({
            to: dto.to,
            subject: 'NeoWell test email',
            text: 'If you can read this, email delivery works.',
          });
          return { ok: true, driver: this.email.constructor.name };
        }
        case 'push': {
          const devices = await this.prisma.device.findMany({ where: { userId: admin.id } });
          if (!devices.length) throw new BadRequestException('Register a device first');
          const results = await Promise.all(
            devices.map((d) =>
              this.push.send({ to: d.pushToken, title: 'NeoWell', body: 'Test push notification' }),
            ),
          );
          return { ok: results.every((r) => r.status === 'ok'), results };
        }
        case 'realtime': {
          const delivered = this.realtime.emitToUser(admin.id, 'notification', {
            title: 'NeoWell',
            body: 'Test websocket message',
          });
          return { ok: delivered > 0, connections: delivered };
        }
        default: {
          const key = await this.storage.put('tests', 'ping.txt', Buffer.from('ok'));
          const back = (await this.storage.read(key)).toString();
          await this.storage.delete([key]);
          return { ok: back === 'ok', driver: this.storage.constructor.name };
        }
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      return { ok: false, error: (e as Error).message };
    }
  }
}
