import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { GoogleAuthService } from "./google-auth.service";
import { GoogleTokenVerifier } from "./google-token-verifier";
import { AdminGuard } from "./admin.guard";
import { LegacyStoryAccessGuard } from "./legacy-story-access.guard";

@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, AdminGuard, LegacyStoryAccessGuard, GoogleAuthService, GoogleTokenVerifier],
  exports: [AuthService, AuthGuard, AdminGuard, LegacyStoryAccessGuard, GoogleAuthService, EmailModule]
})
export class AuthModule {}
