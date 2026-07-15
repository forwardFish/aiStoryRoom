import { BadRequestException, Body, Controller, Delete, Get, Headers, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { CurrentUser, type AuthenticatedUser } from "./current-user.decorator";
import { GoogleAuthService } from "./google-auth.service";

@Controller("v4/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(GoogleAuthService) private readonly google: GoogleAuthService) {}

  @Post("register")
  register(@Body() body: { email?: string; password?: string; nickname?: string; referralCode?: string; returnTo?: string }, @Req() request: any) {
    return this.auth.register({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("verify")
  verify(@Body() body: { token?: string; verificationToken?: string }, @Req() request: any) {
    return this.auth.verify({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("verification/resend")
  resendVerification(@Body() body: { email?: string; returnTo?: string }, @Req() request: any) {
    return this.auth.resendVerification({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("login")
  login(@Body() body: { email?: string; password?: string }, @Req() request: any) {
    return this.auth.login({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("password-reset/request")
  requestPasswordReset(@Body() body: { email?: string }, @Req() request: any) {
    return this.auth.requestPasswordReset({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("password-reset/confirm")
  resetPassword(@Body() body: { email?: string; token?: string; resetToken?: string; password?: string }, @Req() request: any) {
    return this.auth.resetPassword({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("google/challenge")
  googleChallenge(@Headers("x-requested-with") requestedWith: string | undefined, @Req() request: any) {
    assertGoogleBrowserRequest(requestedWith);
    return this.google.createChallenge({ clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("google")
  googleLogin(@Body() body: { credential?: string; challengeId?: string; returnTo?: string }, @Headers("x-requested-with") requestedWith: string | undefined, @Req() request: any) {
    assertGoogleBrowserRequest(requestedWith);
    return this.google.login({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @UseGuards(AuthGuard)
  @Post("google/link")
  linkGoogle(@CurrentUser() user: AuthenticatedUser, @Body() body: { credential?: string; challengeId?: string }, @Headers("x-requested-with") requestedWith: string | undefined, @Req() request: any) {
    assertGoogleBrowserRequest(requestedWith);
    return this.google.link(user, { ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @UseGuards(AuthGuard)
  @Delete("google/link")
  unlinkGoogle(@CurrentUser() user: AuthenticatedUser) {
    return this.google.unlink(user);
  }

  @UseGuards(AuthGuard)
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }
}

function assertGoogleBrowserRequest(requestedWith: string | undefined) {
  if (requestedWith !== "many-worlds-web") {
    throw new BadRequestException({ code: "GOOGLE_BROWSER_REQUEST_REQUIRED", message: "Google sign-in request is invalid" });
  }
}
