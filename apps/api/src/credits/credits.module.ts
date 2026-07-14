import { forwardRef, Module } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { ReferralsModule } from "../referrals/referrals.module";
import { CreditsController } from "./credits.controller";
import { CreditsService } from "./credits.service";

@Module({
  imports: [forwardRef(() => ReferralsModule)],
  controllers: [CreditsController],
  providers: [CreditsService, AuthGuard],
  exports: [CreditsService]
})
export class CreditsModule {}
