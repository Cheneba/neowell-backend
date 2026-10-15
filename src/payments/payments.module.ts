import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { CampayPaymentGateway } from './campay.gateway';
import { PaymentGateway, SandboxPaymentGateway } from './payment-gateway';

/** Picks the payment driver from PAYMENT_PROVIDER. Add a provider = one new case here. */
@Global()
@Module({
  providers: [
    {
      provide: PaymentGateway,
      inject: [ConfigService],
      useFactory: (c: ConfigService<Env, true>): PaymentGateway => {
        if (c.get('PAYMENT_PROVIDER', { infer: true }) === 'CAMPAY')
          return new CampayPaymentGateway({
            baseUrl: c.get('CAMPAY_BASE_URL', { infer: true }).replace(/\/+$/, ''),
            username: c.get('CAMPAY_APP_USERNAME', { infer: true })!,
            password: c.get('CAMPAY_APP_PASSWORD', { infer: true })!,
          });
        return new SandboxPaymentGateway();
      },
    },
  ],
  exports: [PaymentGateway],
})
export class PaymentsModule {}
