import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export interface CreemCheckoutInput {
  productId: string;
  successUrl: string;
  requestId: string;
  metadata: Record<string, string>;
}

@Injectable()
export class CreemClient {
  private readonly baseUrl = process.env.CREEM_MODE === "test" ? "https://test-api.creem.io/v1" : "https://api.creem.io/v1";

  async createCheckout(input: CreemCheckoutInput) {
    if (process.env.CREEM_MOCK_MODE === "true") {
      return { id: `mock_checkout_${input.requestId}`, checkoutUrl: `${input.successUrl}?checkout_id=mock_${input.requestId}` };
    }
    const apiKey = process.env.CREEM_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException({ code: "CREEM_API_KEY_REQUIRED", message: "CREEM_API_KEY is required for dynamic checkout" });
    const response = await fetch(`${this.baseUrl}/checkouts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        product_id: input.productId,
        success_url: input.successUrl,
        request_id: input.requestId,
        metadata: input.metadata
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ServiceUnavailableException({ code: "CREEM_CHECKOUT_FAILED", message: "Creem checkout creation failed", details: { status: response.status, payload } });
    const checkoutUrl = payload.checkout_url || payload.checkoutUrl;
    if (!payload.id || !checkoutUrl) throw new ServiceUnavailableException({ code: "CREEM_CHECKOUT_MALFORMED", message: "Creem returned an invalid checkout response" });
    return { id: payload.id, checkoutUrl };
  }
}
