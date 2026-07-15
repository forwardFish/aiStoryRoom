import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

export interface CreemCheckoutInput {
  productId: string;
  successUrl: string;
  requestId: string;
  metadata: Record<string, string>;
}

@Injectable()
export class CreemClient {
  private readonly baseUrl = process.env.CREEM_MODE === "test" ? "https://test-api.creem.io/v1" : "https://api.creem.io/v1";
  private readonly logger = new Logger(CreemClient.name);

  async createCheckout(input: CreemCheckoutInput) {
    if (process.env.CREEM_MOCK_MODE === "true") {
      const mockUrl = new URL(input.successUrl);
      mockUrl.searchParams.set("checkout_id", `mock_checkout_${input.requestId}`);
      return { id: `mock_checkout_${input.requestId}`, checkoutUrl: mockUrl.toString() };
    }
    const apiKey = process.env.CREEM_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException({ code: "CREEM_API_KEY_REQUIRED", message: "CREEM_API_KEY is required for dynamic checkout" });
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/checkouts`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          product_id: input.productId,
          success_url: input.successUrl,
          request_id: input.requestId,
          metadata: input.metadata
        })
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Keep provider/network diagnostics in Railway logs; never return keys or
      // lower-level transport data to the browser.
      this.logger.error(`Creem checkout request could not reach ${this.baseUrl}: ${reason}`);
      throw new ServiceUnavailableException({ code: "CREEM_CONNECTION_FAILED", message: "Unable to contact the payment provider. Please try again shortly." });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ServiceUnavailableException({ code: "CREEM_CHECKOUT_FAILED", message: "Creem checkout creation failed", details: { status: response.status, payload } });
    const checkoutUrl = payload.checkout_url || payload.checkoutUrl;
    if (!payload.id || !checkoutUrl) throw new ServiceUnavailableException({ code: "CREEM_CHECKOUT_MALFORMED", message: "Creem returned an invalid checkout response" });
    return { id: payload.id, checkoutUrl };
  }
}
