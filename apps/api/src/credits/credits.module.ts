import { forwardRef, Module } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { ReferralsModule } from "../referrals/referrals.module";
import { CreditsController } from "./credits.controller";
import { CreditsService } from "./credits.service";
import { CreditConsumptionService } from "./credit-consumption.service";
import { RunSponsorshipController } from "./run-sponsorship.controller";
import { RunSponsorshipService } from "./run-sponsorship.service";
import { CreditChargeReconcilerService } from "./credit-charge-reconciler.service";

@Module({
  imports: [forwardRef(() => ReferralsModule)],
  controllers: [CreditsController, RunSponsorshipController],
  providers: [CreditsService, CreditConsumptionService, CreditChargeReconcilerService, RunSponsorshipService, AuthGuard],
  exports: [CreditsService, CreditConsumptionService, CreditChargeReconcilerService, RunSponsorshipService]
})
export class CreditsModule {}
