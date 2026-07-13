import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { CreditsModule } from "./credits/credits.module";
import { MvpCatalogController } from "./mvp-catalog.controller";
import { ReferralsModule } from "./referrals/referrals.module";
import { StoryAccessModule } from "./story-access/story-access.module";
import { StoryController } from "./story.controller";
import { PrismaService } from "./prisma.service";
import { StoryService } from "./story.service";

@Module({
  imports: [AuthModule, CreditsModule, ReferralsModule, BillingModule, StoryAccessModule],
  controllers: [MvpCatalogController, StoryController],
  providers: [PrismaService, StoryService]
})
export class AppModule {}
