import { Module, forwardRef } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CreditsModule } from "../credits/credits.module";
import { BillingAdminController, BillingController } from "./billing.controller";
import { BillingAdminGuard } from "./billing-admin.guard";
import { BillingService } from "./billing.service";
import { CreemClient } from "./creem.client";
import { CreemWebhookController } from "./creem-webhook.controller";
import { CreemWebhookService } from "./creem-webhook.service";

@Module({
  imports: [forwardRef(() => CreditsModule)],
  controllers: [BillingController, BillingAdminController, CreemWebhookController],
  providers: [BillingService, CreemClient, CreemWebhookService, AuthGuard, BillingAdminGuard],
  exports: [BillingService, CreemWebhookService]
})
export class BillingModule {}
