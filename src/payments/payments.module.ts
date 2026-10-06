import { Global, Module } from '@nestjs/common';
import { PaymentGateway, SandboxPaymentGateway } from './payment-gateway';

@Global()
@Module({
  providers: [{ provide: PaymentGateway, useClass: SandboxPaymentGateway }],
  exports: [PaymentGateway],
})
export class PaymentsModule {}
