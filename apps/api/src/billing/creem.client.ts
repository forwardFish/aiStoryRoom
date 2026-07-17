import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

export interface CreemCheckoutInput {
  productId: string;
  successUrl: string;
  requestId: string;
  metadata: Record<string, string>;
}

export interface CreemRefundInput {
  transactionId: string;
  amountCents: number;
  reason: string;
  requestId: string;
}

@Injectable()
export class CreemClient {
  private readonly logger = new Logger(CreemClient.name);

  private apiKey() {
    const apiKey = process.env.CREEM_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException({ code: "CREEM_API_KEY_REQUIRED", message: "CREEM_API_KEY is required for payment operations" });
    return apiKey;
  }

  private async providerRequest(url: string, init: RequestInit, operation: string) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Creem ${operation} request could not reach ${new URL(url).origin}: ${reason}`);
      throw new ServiceUnavailableException({ code: "CREEM_CONNECTION_FAILED", message: "Unable to contact the payment provider. Please try again shortly." });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      this.logger.error(`Creem ${operation} failed with HTTP ${response.status}`);
      throw new ServiceUnavailableException({ code: `CREEM_${operation.toUpperCase()}_FAILED`, message: `Creem ${operation} failed`, details: { status: response.status } });
    }
    return payload;
  }

  async createCheckout(input: CreemCheckoutInput) {
    if (process.env.CREEM_MOCK_MODE === "true") {
      if (!creemMockCheckoutAllowed()) {
        throw new ServiceUnavailableException({
          code: "CREEM_MOCK_MODE_FORBIDDEN",
          message: "Creem mock checkout is allowed only in non-production Test mode"
        });
      }
      const mockUrl = new URL(input.successUrl);
      mockUrl.searchParams.set("checkout_id", `mock_checkout_${input.requestId}`);
      return { id: `mock_checkout_${input.requestId}`, checkoutUrl: mockUrl.toString() };
    }
    const baseUrl = creemBaseUrl();
    const apiKey = this.apiKey();
    const payload = await this.providerRequest(`${baseUrl}/checkouts`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          product_id: input.productId,
          success_url: input.successUrl,
          request_id: input.requestId,
          metadata: input.metadata
        })
      }, "checkout");
    const checkoutUrl = payload.checkout_url || payload.checkoutUrl;
    if (!payload.id || !checkoutUrl) throw new ServiceUnavailableException({ code: "CREEM_CHECKOUT_MALFORMED", message: "Creem returned an invalid checkout response" });
    return { id: payload.id, checkoutUrl };
  }

  async getTransaction(transactionId: string) {
    const url = new URL(`${creemBaseUrl()}/transactions`);
    url.searchParams.set("transaction_id", transactionId);
    return this.providerRequest(url.toString(), { headers: { "x-api-key": this.apiKey() } }, "transaction_lookup");
  }

  /**
   * Creem's public REST reference and official SDK do not currently publish a
   * create-refund operation. This adapter therefore stays disabled unless
   * Creem support supplies an account-approved relative endpoint contract.
   * It deliberately cannot call an arbitrary host.
   */
  async createRefund(input: CreemRefundInput) {
    const template = String(process.env.CREEM_REFUND_API_PATH || "").trim();
    if (!template) {
      throw new ServiceUnavailableException({
        code: "CREEM_REFUND_API_NOT_AVAILABLE",
        message: "Creem has not provided a public refund API contract for this account"
      });
    }
    if (!template.startsWith("/v1/") || !template.includes("{transactionId}") || template.includes("?") || template.includes("#")) {
      throw new ServiceUnavailableException({ code: "CREEM_REFUND_API_PATH_INVALID", message: "The approved Creem refund API path is invalid" });
    }
    const path = template.replace("{transactionId}", encodeURIComponent(input.transactionId));
    const payload = await this.providerRequest(`${creemBaseUrl().replace(/\/v1$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey(), "idempotency-key": input.requestId },
      body: JSON.stringify({ transaction_id: input.transactionId, amount: input.amountCents, reason: input.reason, request_id: input.requestId })
    }, "refund");
    const id = String(payload.id || payload.refund_id || "");
    const status = String(payload.status || "submitted");
    if (!id) throw new ServiceUnavailableException({ code: "CREEM_REFUND_MALFORMED", message: "Creem returned an invalid refund response" });
    return { id, status, payload };
  }
}

export function creemConfigurationReadiness(environment: NodeJS.ProcessEnv = process.env) {
  const mode = normalizeCreemMode(environment.CREEM_MODE, "configuration") ?? "invalid";
  const runtimeMode = creemRuntimeMode(environment);
  const mockMode = environment.CREEM_MOCK_MODE === "true";
  const production = environment.NODE_ENV === "production";
  const mockCheckoutAllowed = creemMockCheckoutAllowed(environment);
  const apiKeyConfigured = Boolean(String(environment.CREEM_API_KEY || "").trim());
  const webhookSecretConfigured = Boolean(String(environment.CREEM_WEBHOOK_SECRET || "").trim());
  const explicitProduct300 = Boolean(String(environment.CREEM_PRODUCT_300_ID || "").trim());
  const explicitProduct650 = Boolean(String(environment.CREEM_PRODUCT_650_ID || "").trim());
  const productsConfigured = mode === "test" ? true : explicitProduct300 && explicitProduct650;
  const mockAllowed = mockMode && mockCheckoutAllowed;
  const checkoutReady = runtimeMode !== null && productsConfigured && (mockAllowed || apiKeyConfigured);
  const webhookReady = mockAllowed || webhookSecretConfigured;
  const adminReviewReady = String(environment.ADMIN_EMAILS || "").split(",").some((value) => value.trim().includes("@"));
  const refundPath = String(environment.CREEM_REFUND_API_PATH || "").trim();
  const automaticRefundReady = refundPath.startsWith("/v1/") && refundPath.includes("{transactionId}") && !refundPath.includes("?") && !refundPath.includes("#");
  const ready = checkoutReady && webhookReady && (!mockMode || mockCheckoutAllowed) && (!production || (mode === "live" && !mockMode));
  return {
    ready,
    mode,
    mockMode,
    checkout: {
      ready: checkoutReady,
      apiKeyConfigured,
      productsConfigured,
      usingDefaultTestProducts: mode === "test" && !(explicitProduct300 && explicitProduct650)
    },
    webhook: { ready: webhookReady, secretConfigured: webhookSecretConfigured },
    refund: { adminReviewReady, automaticSubmissionReady: automaticRefundReady },
    closureReady: ready && adminReviewReady && automaticRefundReady
  };
}

export function creemBaseUrl(environment: NodeJS.ProcessEnv = process.env) {
  const mode = normalizeCreemMode(environment.CREEM_MODE, "configuration");
  if (mode === "test" && !creemTestModeAllowed(environment)) {
    throw new ServiceUnavailableException({
      code: "CREEM_TEST_MODE_FORBIDDEN",
      message: "Creem Test mode requires explicit NODE_ENV=test or NODE_ENV=development"
    });
  }
  if (mode === "test") return "https://test-api.creem.io/v1";
  if (mode === "live") return "https://api.creem.io/v1";
  throw new ServiceUnavailableException({ code: "CREEM_MODE_REQUIRED", message: "CREEM_MODE must be explicitly set to test or live" });
}

export function creemTestModeAllowed(environment: NodeJS.ProcessEnv = process.env) {
  return ["test", "development"].includes(String(environment.NODE_ENV || "").trim().toLowerCase());
}

export function creemRuntimeMode(environment: NodeJS.ProcessEnv = process.env): CreemEnvironment | null {
  const mode = normalizeCreemMode(environment.CREEM_MODE, "configuration");
  return mode === "test" && !creemTestModeAllowed(environment) ? null : mode;
}

export function creemMockCheckoutAllowed(environment: NodeJS.ProcessEnv = process.env) {
  return creemRuntimeMode(environment) === "test";
}

export type CreemEnvironment = "test" | "live";

export function normalizeCreemMode(value: unknown, source: "configuration" | "provider" = "configuration"): CreemEnvironment | null {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "test") return "test";
  if (mode === "live") return "live";
  if (source === "provider" && ["sandbox", "local"].includes(mode)) return "test";
  if (source === "provider" && ["prod", "production"].includes(mode)) return "live";
  return null;
}
