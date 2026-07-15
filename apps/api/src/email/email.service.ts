import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { FileSinkEmailProvider } from "./providers/file-sink.provider";
import { ResendEmailProvider } from "./providers/resend.provider";
import type { EmailDelivery, EmailProvider } from "./email.types";
import { verifyEmailTemplate } from "./templates/verify-email";
import { resetPasswordTemplate } from "./templates/reset-password";
import { safeAuthReturnTo } from "../auth/auth-return-to";

@Injectable()
export class EmailService {
  private readonly provider: EmailProvider;
  private readonly configuredProvider: string;

  constructor() {
    const production = process.env.NODE_ENV === "production";
    this.configuredProvider = String(process.env.EMAIL_PROVIDER || (production ? "resend" : "file-sink")).trim().toLowerCase();
    this.provider = this.configuredProvider === "resend" ? new ResendEmailProvider() : new FileSinkEmailProvider();
  }

  readiness() {
    if (process.env.NODE_ENV !== "production") return { ready: true, provider: this.provider.name };
    if (this.configuredProvider !== "resend" || !(this.provider instanceof ResendEmailProvider) || !this.provider.isConfigured()) {
      return { ready: false, provider: this.configuredProvider || "unset", reason: "EMAIL_PROVIDER=resend with RESEND_API_KEY and EMAIL_FROM is required in production" };
    }
    return { ready: true, provider: this.provider.name };
  }

  async sendVerification(input: { email: string; token: string; returnTo?: string; idempotencyKey: string }) {
    const url = verificationUrl(input.token, input.returnTo);
    return this.send(input.email, verifyEmailTemplate(url), input.idempotencyKey);
  }

  async sendPasswordReset(input: { email: string; token: string; idempotencyKey: string }) {
    const url = passwordResetUrl(input.token);
    return this.send(input.email, resetPasswordTemplate(url), input.idempotencyKey);
  }

  private async send(to: string, template: { subject: string; text: string; html: string }, idempotencyKey: string): Promise<EmailDelivery> {
    const readiness = this.readiness();
    if (!readiness.ready) throw new ServiceUnavailableException({ code: "EMAIL_PROVIDER_NOT_READY", message: "Transactional email is not configured" });
    return this.provider.send({ to, ...template, idempotencyKey });
  }
}

function verificationUrl(token: string, returnTo?: string) {
  const base = String(process.env.PUBLIC_WEB_URL || "http://localhost:5177").replace(/\/$/, "");
  const url = new URL(`${base}/auth`);
  url.searchParams.set("mode", "verify");
  url.searchParams.set("token", token);
  if (returnTo) url.searchParams.set("returnTo", safeAuthReturnTo(returnTo));
  return url.toString();
}

function passwordResetUrl(token: string) {
  const base = String(process.env.PUBLIC_WEB_URL || "http://localhost:5177").replace(/\/$/, "");
  const url = new URL(`${base}/reset-password`);
  url.searchParams.set("token", token);
  return url.toString();
}
