import { narrativeSlotIds, type NarrativeSlotId } from "./scene-expression.js";

type UnknownRecord = Record<string, unknown>;

/**
 * Normalizes model transport variants before the authoritative SceneDraft
 * contract is validated. It accepts only equivalent encodings: a slot map or
 * a list of { slot, value } / { slot, text } pairs. It never changes prose or
 * invents slots.
 */
export function normalizeSceneDraftTransport(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.slots)) return input;
  const slots: Partial<Record<NarrativeSlotId, string>> = {};
  for (const entry of input.slots) {
    if (!isRecord(entry) || Object.keys(entry).some((key) => (
      key !== "slot" && key !== "value" && key !== "text"
    ))) {
      throw new Error("SCENE_DRAFT_SLOT_LIST_ENTRY_INVALID");
    }
    const proseKeys = ["value", "text"].filter((key) => Object.hasOwn(entry, key));
    if (proseKeys.length !== 1) throw new Error("SCENE_DRAFT_SLOT_LIST_ENTRY_INVALID");
    const slot = String(entry.slot || "");
    if (!narrativeSlotIds.includes(slot as NarrativeSlotId)) {
      throw new Error("SCENE_DRAFT_SLOT_UNKNOWN");
    }
    if (Object.prototype.hasOwnProperty.call(slots, slot)) {
      throw new Error("SCENE_DRAFT_SLOT_DUPLICATE:" + slot);
    }
    const prose = entry[proseKeys[0]!];
    if (typeof prose !== "string" || !prose.trim()) {
      throw new Error("SCENE_DRAFT_SLOT_EMPTY");
    }
    slots[slot as NarrativeSlotId] = prose;
  }
  return { ...input, slots };
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
