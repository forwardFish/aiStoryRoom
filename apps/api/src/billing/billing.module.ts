import { Module, forwardRef } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PrismaService } from "../prisma.service";
import { CreditsModule } from "../credits/credits.module";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { CreemClient } from "./creem.client";
import { CreemWebhookController } from "./creem-webhook.controller";
import { CreemWebhookService } from "./creem-webhook.service";

@Module({
  imports: [forwardRef(() => CreditsModule)],
  controllers: [BillingController, CreemWebhookController],
  providers: [BillingService, CreemClient, CreemWebhookService, PrismaService, AuthGuard],
  exports: [BillingService, CreemWebhookService]
})
export class BillingModule {}
