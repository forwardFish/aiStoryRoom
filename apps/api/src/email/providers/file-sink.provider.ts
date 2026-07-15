import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { AuthEmailMessage, EmailDelivery, EmailProvider } from "../email.types";

/** Non-production email transport. The file is a local test artifact, never a production fallback. */
export class FileSinkEmailProvider implements EmailProvider {
  readonly name = "file-sink";

  constructor(private readonly path = process.env.AUTH_MAIL_SINK_FILE || ".auth-mail-sink.ndjson") {}

  async send(message: AuthEmailMessage): Promise<EmailDelivery> {
    await mkdir(dirname(this.path), { recursive: true });
    const providerId = `file_${randomUUID()}`;
    await appendFile(this.path, `${JSON.stringify({ provider: this.name, providerId, ...message, createdAt: new Date().toISOString() })}\n`, "utf8");
    return { provider: this.name, providerId };
  }
}
