import { ServiceUnavailableException } from "@nestjs/common";
import type { AuthEmailMessage, EmailDelivery, EmailProvider } from "../email.types";

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey = String(process.env.RESEND_API_KEY || "").trim(),
    private readonly from = String(process.env.EMAIL_FROM || "").trim(),
    private readonly replyTo = String(process.env.EMAIL_REPLY_TO || "").trim()
  ) {}

  isConfigured() {
    return Boolean(this.apiKey && this.from);
  }

  async send(message: AuthEmailMessage): Promise<EmailDelivery> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException({ code: "EMAIL_PROVIDER_NOT_READY", message: "Transactional email is not configured" });
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": message.idempotencyKey
      },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html, ...(this.replyTo ? { reply_to: this.replyTo } : {}) })
    }).catch(() => null);
    if (!response?.ok) {
      throw new ServiceUnavailableException({ code: "EMAIL_DELIVERY_FAILED", message: "Unable to deliver authentication email" });
    }
    const body = await response.json().catch(() => ({})) as { id?: unknown };
    return { provider: this.name, providerId: typeof body.id === "string" ? body.id : null };
  }
}
