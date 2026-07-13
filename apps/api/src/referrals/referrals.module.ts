import { Module, forwardRef } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PrismaService } from "../prisma.service";
import { CreditsModule } from "../credits/credits.module";
import { ReferralsController } from "./referrals.controller";
import { ReferralsService } from "./referrals.service";

@Module({
  imports: [forwardRef(() => CreditsModule)],
  controllers: [ReferralsController],
  providers: [ReferralsService, PrismaService, AuthGuard],
  exports: [ReferralsService]
})
export class ReferralsModule {}
