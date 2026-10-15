import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Env } from '../config/env';
import { RealtimeGateway } from './realtime.gateway';
import { Realtime } from './realtime.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
      }),
    }),
  ],
  providers: [RealtimeGateway, { provide: Realtime, useExisting: RealtimeGateway }],
  exports: [Realtime],
})
export class RealtimeModule {}
