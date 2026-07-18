import { EVENT_DELIVERY_PAGE_SCHEMA_VERSION } from "./constants";
import { fail, integerAtLeast, isRecord, pass, type ValidationResult } from "./schema-utils";

export type EventDeliveryV1 = {
  deliverySequence: number;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type EventDeliveryPageV1 = {
  schemaVersion: typeof EVENT_DELIVERY_PAGE_SCHEMA_VERSION;
  deliveries: EventDeliveryV1[];
  nextAfterDeliverySequence: number;
  hasMore: boolean;
};

export function validateEventDeliveryPageV1(value: unknown, afterDeliverySequence: number): ValidationResult<EventDeliveryPageV1> {
  if (!isRecord(value)) return fail(["delivery page must be an object"]);
  const errors: string[] = [];
  if (value.schemaVersion !== EVENT_DELIVERY_PAGE_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!Array.isArray(value.deliveries)) errors.push("deliveries must be an array");
  if (!integerAtLeast(value.nextAfterDeliverySequence, afterDeliverySequence)) errors.push("nextAfterDeliverySequence moved backwards");
  if (typeof value.hasMore !== "boolean") errors.push("hasMore must be boolean");
  if (Array.isArray(value.deliveries)) {
    let expected = afterDeliverySequence + 1;
    for (const item of value.deliveries) {
      if (!isRecord(item) || item.deliverySequence !== expected) {
        errors.push(`deliverySequence must be dense at ${expected}`);
        break;
      }
      expected += 1;
    }
    if (value.nextAfterDeliverySequence !== expected - 1) errors.push("nextAfterDeliverySequence does not match the last dense delivery");
  }
  return errors.length ? fail(errors) : pass(value as EventDeliveryPageV1);
}

export const eventDeliveryPageJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: EVENT_DELIVERY_PAGE_SCHEMA_VERSION,
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "deliveries", "nextAfterDeliverySequence", "hasMore"],
  properties: {
    schemaVersion: { const: EVENT_DELIVERY_PAGE_SCHEMA_VERSION },
    deliveries: { type: "array", items: { type: "object", additionalProperties: false, required: ["deliverySequence", "eventId", "eventType", "payload", "createdAt"], properties: { deliverySequence: { type: "integer", minimum: 1 }, eventId: { type: "string", minLength: 1 }, eventType: { type: "string", minLength: 1 }, payload: { type: "object" }, createdAt: { type: "string", minLength: 1 } } } },
    nextAfterDeliverySequence: { type: "integer", minimum: 0 },
    hasMore: { type: "boolean" }
  }
} as const;
