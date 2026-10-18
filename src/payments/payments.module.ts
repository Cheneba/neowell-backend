import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { CamPayGateway } from './campay.gateway';
import { PaymentGateway, SandboxPaymentGateway } from './payment-gateway';

@Global()
@Module({
  providers: [
    {
      provide: PaymentGateway,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('PAYMENT_PROVIDER', { infer: true }) === 'CAMPAY'
          ? new CamPayGateway(config)
          : new SandboxPaymentGateway(),
    },
  ],
  exports: [PaymentGateway],
})
export class PaymentsModule {}
