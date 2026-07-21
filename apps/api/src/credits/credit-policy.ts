import { createHash } from "node:crypto";
import type { BillingPriceSnapshot, CreditPolicyVersion } from "../config/credit-consumption.config";

export type CreditActionClass = "RUN_CREATE" | "STANDARD_CHOICE" | "CUSTOM_ACTION" | "COMPLEX_ACTION" | "NON_BILLABLE";

export type CreditActionInput = {
  actorKind: "HUMAN" | "AI" | "SYSTEM";
  candidateId?: string;
  customAction?: string;
  decisionForm?: "STORY_CHOICE" | "CONVERSATION" | "INVESTIGATION" | "LEVERAGE" | "CUSTOM_PLAN";
  operation: string;
};

const NON_BILLABLE_OPERATIONS = new Set([
  "READ", "HEARTBEAT", "DONE", "LEAVE_STAGE", "HANDOFF", "RECLAIM",
  "AI_FALLBACK", "TIMEOUT_FALLBACK", "CROSS_ROLE_IMPACT", "CONDITIONAL_TRIGGER"
]);

export function classifyCreditAction(input: CreditActionInput): CreditActionClass {
  if (input.actorKind !== "HUMAN") return "NON_BILLABLE";
  const operation = String(input.operation || "").trim().toUpperCase();
  if (NON_BILLABLE_OPERATIONS.has(operation)) return "NON_BILLABLE";
  if (operation === "RUN_CREATE") return "RUN_CREATE";
  if (String(input.customAction || "").trim()) {
    return input.decisionForm && input.decisionForm !== "STORY_CHOICE" ? "COMPLEX_ACTION" : "CUSTOM_ACTION";
  }
  if (["CONVERSATION", "INVESTIGATION", "LEVERAGE", "CUSTOM_PLAN"].includes(String(input.decisionForm || ""))) {
    return "COMPLEX_ACTION";
  }
  if (String(input.candidateId || "").trim() || ["MAIN", "MANEUVER", "REACTION"].includes(operation)) return "STANDARD_CHOICE";
  return "NON_BILLABLE";
}

export function priceForCreditAction(actionClass: CreditActionClass, prices: BillingPriceSnapshot) {
  if (actionClass === "RUN_CREATE") return prices.runCreate;
  if (actionClass === "STANDARD_CHOICE") return prices.standardAction;
  if (actionClass === "CUSTOM_ACTION") return prices.customAction;
  if (actionClass === "COMPLEX_ACTION") return prices.complexAction;
  return 0;
}

export function parseRunBilling(input: {
  billingPolicyVersion?: string | null;
  billingPriceJson?: unknown;
}, fallbackPrices: BillingPriceSnapshot): { policyVersion: CreditPolicyVersion; prices: BillingPriceSnapshot } {
  const policyVersion = input.billingPolicyVersion === "active_action_v1" ? "active_action_v1" : "world_unlock_v1";
  if (policyVersion === "world_unlock_v1") return { policyVersion, prices: fallbackPrices };
  const value = input.billingPriceJson;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ACTIVE_ACTION_PRICE_SNAPSHOT_MISSING");
  const record = value as Record<string, unknown>;
  const prices: BillingPriceSnapshot = {
    currency: "WORLD_CREDITS",
    runCreate: snapshotPrice(record.runCreate, "runCreate"),
    standardAction: snapshotPrice(record.standardAction, "standardAction"),
    customAction: snapshotPrice(record.customAction, "customAction"),
    complexAction: snapshotPrice(record.complexAction, "complexAction"),
    sponsorshipPack: snapshotPrice(record.sponsorshipPack, "sponsorshipPack")
  };
  if (record.currency !== "WORLD_CREDITS") throw new Error("ACTIVE_ACTION_PRICE_SNAPSHOT_CURRENCY_INVALID");
  return { policyVersion, prices };
}

export function creditRequestHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function snapshotPrice(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 10_000) throw new Error(`ACTIVE_ACTION_PRICE_SNAPSHOT_${field.toUpperCase()}_INVALID`);
  return parsed;
}
