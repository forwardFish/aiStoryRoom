import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { AdminGuard } from "./admin.guard";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { AuthenticatedUserResolver } from "./authenticated-user-resolver";
import { GoogleAuthService } from "./google-auth.service";
import { GoogleTokenVerifier } from "./google-token-verifier";
import { LegacyStoryAccessGuard } from "./legacy-story-access.guard";

@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthenticatedUserResolver,
    AuthGuard,
    AdminGuard,
    LegacyStoryAccessGuard,
    GoogleAuthService,
    GoogleTokenVerifier,
  ],
  exports: [
    AuthService,
    AuthenticatedUserResolver,
    AuthGuard,
    AdminGuard,
    LegacyStoryAccessGuard,
    GoogleAuthService,
    EmailModule,
  ],
})
export class AuthModule {}
