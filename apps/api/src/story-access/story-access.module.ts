import { Module, forwardRef } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CreditsModule } from "../credits/credits.module";
import { ReferralsModule } from "../referrals/referrals.module";
import { StoryAccessController } from "./story-access.controller";
import { StoryAccessService } from "./story-access.service";

@Module({
  imports: [forwardRef(() => CreditsModule), forwardRef(() => ReferralsModule)],
  controllers: [StoryAccessController],
  providers: [StoryAccessService, AuthGuard],
  exports: [StoryAccessService]
})
export class StoryAccessModule {}
