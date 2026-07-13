import { Module, forwardRef } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CreditsModule } from "../credits/credits.module";
import { PrismaService } from "../prisma.service";
import { ReferralsModule } from "../referrals/referrals.module";
import { StoryAccessController } from "./story-access.controller";
import { StoryAccessService } from "./story-access.service";

@Module({
  imports: [forwardRef(() => CreditsModule), forwardRef(() => ReferralsModule)],
  controllers: [StoryAccessController],
  providers: [StoryAccessService, PrismaService, AuthGuard],
  exports: [StoryAccessService]
})
export class StoryAccessModule {}
