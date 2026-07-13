import { Controller, Headers, HttpCode, Inject, Post, UnauthorizedException, Req } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { CreemWebhookService } from "./creem-webhook.service";

function verifySignature(rawBody: Buffer, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = Buffer.from(signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

@Controller("v4/webhooks")
export class CreemWebhookController {
  constructor(@Inject(CreemWebhookService) private readonly webhooks: CreemWebhookService) {}

  @Post("creem")
  @HttpCode(200)
  async receive(@Req() request: any, @Headers("creem-signature") signature?: string) {
    const rawBody = Buffer.isBuffer(request.rawBody) ? request.rawBody : Buffer.from(JSON.stringify(request.body || {}));
    const secret = process.env.CREEM_WEBHOOK_SECRET;
    if (!secret || !signature || !verifySignature(rawBody, signature, secret)) throw new UnauthorizedException({ code: "INVALID_CREEM_SIGNATURE", message: "Invalid Creem signature" });
    return this.webhooks.process(JSON.parse(rawBody.toString("utf8")));
  }
}
