import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BabiesModule } from './babies/babies.module';
import { ChecksModule } from './checks/checks.module';
import { CliniciansModule } from './clinicians/clinicians.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { Env, validateEnv } from './config/env';
import { ConsultationsModule } from './consultations/consultations.module';
import { DrugChartsModule } from './drug-charts/drug-charts.module';
import { FacilitiesModule } from './facilities/facilities.module';
import { GrowthModule } from './growth/growth.module';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { VoiceModule } from './voice/voice.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        skipIf: () => config.get('NODE_ENV', { infer: true }) === 'test',
      }),
    }),
    PrismaModule,
    JobsModule,
    NotificationsModule,
    StorageModule,
    PaymentsModule,
    AuthModule,
    UsersModule,
    BabiesModule,
    GrowthModule,
    ChecksModule,
    VoiceModule,
    ReportsModule,
    FacilitiesModule,
    CliniciansModule,
    ConsultationsModule,
    DrugChartsModule,
    AdminModule,
    SchedulerModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate-limit, then authenticate, then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
