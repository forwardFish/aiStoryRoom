import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { GoogleAuthService } from "./google-auth.service";
import { GoogleTokenVerifier } from "./google-token-verifier";

@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, GoogleAuthService, GoogleTokenVerifier],
  exports: [AuthService, AuthGuard, GoogleAuthService, EmailModule]
})
export class AuthModule {}
