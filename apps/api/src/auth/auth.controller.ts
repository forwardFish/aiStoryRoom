import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { CurrentUser, type AuthenticatedUser } from "./current-user.decorator";

@Controller("v4/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: { email?: string; password?: string; nickname?: string; referralCode?: string }) {
    return this.auth.register(body);
  }

  @Post("verify")
  verify(@Body() body: { email?: string; verificationToken?: string }) {
    return this.auth.verify(body);
  }

  @Post("login")
  login(@Body() body: { email?: string; password?: string }) {
    return this.auth.login(body);
  }

  @UseGuards(AuthGuard)
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }
}
