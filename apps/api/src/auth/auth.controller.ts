import { BadRequestException, Body, Controller, Delete, Get, Headers, Inject, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { CurrentUser, type AuthenticatedUser } from "./current-user.decorator";
import { GoogleAuthService } from "./google-auth.service";
import { clearSessionCookies, issueSessionCookie } from "./auth-cookie";

@Controller("v4/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(GoogleAuthService) private readonly google: GoogleAuthService) {}

  @Post("register")
  register(@Body() body: { email?: string; password?: string; nickname?: string; referralCode?: string; returnTo?: string }, @Req() request: any) {
    return this.auth.register({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("verify")
  async verify(@Body() body: { token?: string; verificationToken?: string }, @Req() request: any, @Res({ passthrough: true }) response: any) {
    return this.writeBrowserSession(response, await this.auth.verify({ ...body, clientIp: request.ip || request.socket?.remoteAddress }));
  }

  @Post("verification/resend")
  resendVerification(@Body() body: { email?: string; returnTo?: string }, @Req() request: any) {
    return this.auth.resendVerification({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("login")
  async login(@Body() body: { email?: string; password?: string }, @Req() request: any, @Res({ passthrough: true }) response: any) {
    return this.writeBrowserSession(response, await this.auth.login({ ...body, clientIp: request.ip || request.socket?.remoteAddress }));
  }

  @Post("password-reset/request")
  requestPasswordReset(@Body() body: { email?: string }, @Req() request: any) {
    return this.auth.requestPasswordReset({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("password-reset/confirm")
  async resetPassword(@Body() body: { email?: string; token?: string; resetToken?: string; password?: string }, @Req() request: any, @Res({ passthrough: true }) response: any) {
    const result = await this.auth.resetPassword({ ...body, clientIp: request.ip || request.socket?.remoteAddress });
    clearSessionCookies(response);
    return result;
  }

  @Post("google/challenge")
  googleChallenge(@Headers("x-requested-with") requestedWith: string | undefined, @Req() request: any) {
    assertGoogleBrowserRequest(requestedWith);
    return this.google.createChallenge({ clientIp: request.ip || request.socket?.remoteAddress });
  }

  @Post("google")
  async googleLogin(@Body() body: { credential?: string; challengeId?: string; returnTo?: string }, @Headers("x-requested-with") requestedWith: string | undefined, @Req() request: any, @Res({ passthrough: true }) response: any) {
    assertGoogleBrowserRequest(requestedWith);
    return this.writeBrowserSession(response, await this.google.login({ ...body, clientIp: request.ip || request.socket?.remoteAddress }));
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

  @UseGuards(AuthGuard)
  @Patch("me")
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() body: { nickname?: string }) {
    return this.auth.updateProfile(user.id, body);
  }

  // One-time bridge for existing browsers that still hold a pre-cookie token.
  // AuthGuard validates the bearer token and writes the new HttpOnly cookie;
  // the browser deletes the legacy localStorage value immediately afterwards.
  @UseGuards(AuthGuard)
  @Post("session/upgrade")
  upgradeSession() {
    return { upgraded: true };
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) response: any) {
    clearSessionCookies(response);
    return { loggedOut: true };
  }

  private writeBrowserSession(response: any, session: Record<string, unknown>) {
    const token = String(session.accessToken || session.token || "");
    if (!token) throw new BadRequestException({ code: "AUTH_SESSION_MISSING", message: "Authentication session could not be created" });
    issueSessionCookie(response, token);
    const { token: _token, accessToken: _accessToken, ...safe } = session;
    return safe;
  }
}

function assertGoogleBrowserRequest(requestedWith: string | undefined) {
  if (requestedWith !== "many-worlds-web") {
    throw new BadRequestException({ code: "GOOGLE_BROWSER_REQUEST_REQUIRED", message: "Google sign-in request is invalid" });
  }
}
