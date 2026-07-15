import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { OAuth2Client } from "google-auth-library";

export type VerifiedGoogleIdentity = {
  subject: string;
  email: string;
  emailVerified: boolean;
  hostedDomain: string | null;
  nonce: string;
  name: string | null;
  picture: string | null;
};

@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();

  async verify(credential: string): Promise<VerifiedGoogleIdentity> {
    const clientId = String(process.env.GOOGLE_WEB_CLIENT_ID || "").trim();
    if (!clientId || process.env.GOOGLE_AUTH_ENABLED === "false") {
      throw new ServiceUnavailableException({ code: "GOOGLE_AUTH_NOT_READY", message: "Google sign-in is not configured" });
    }
    if (!credential) throw new BadRequestException({ code: "GOOGLE_CREDENTIAL_REQUIRED", message: "Google credential is required" });
    let payload: Record<string, unknown> | undefined;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload() as Record<string, unknown> | undefined;
    } catch {
      throw new UnauthorizedException({ code: "INVALID_GOOGLE_CREDENTIAL", message: "Google credential is invalid or expired" });
    }
    const issuer = String(payload?.iss || "");
    const expiry = Number(payload?.exp);
    const subject = String(payload?.sub || "");
    const email = String(payload?.email || "").trim().toLowerCase();
    const nonce = String(payload?.nonce || "");
    if (!subject || !email || !nonce || !["accounts.google.com", "https://accounts.google.com"].includes(issuer) || !Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException({ code: "INVALID_GOOGLE_CREDENTIAL", message: "Google credential is invalid or expired" });
    }
    return {
      subject,
      email,
      emailVerified: payload?.email_verified === true || payload?.email_verified === "true",
      hostedDomain: typeof payload?.hd === "string" && payload.hd ? payload.hd : null,
      nonce,
      name: typeof payload?.name === "string" ? payload.name.slice(0, 80) : null,
      picture: typeof payload?.picture === "string" ? payload.picture.slice(0, 2_000) : null
    };
  }
}
