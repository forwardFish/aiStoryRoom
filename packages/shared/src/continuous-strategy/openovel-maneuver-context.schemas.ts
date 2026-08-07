export const OPENOVEL_CONFIRMED_MANEUVER_CONTEXT_SCHEMA = "openovel_confirmed_maneuver_context_v1" as const;
export const OPENOVEL_CONFIRMED_MANEUVER_CONTEXT_TAG = "OPENOVEL_SERVER_CONFIRMED_MANEUVERS_V1" as const;

export type OpenNovelConfirmedManeuverSummaryV1 = {
  resultId: string;
  decisionForm: "CONVERSATION" | "INVESTIGATION" | "LEVERAGE" | "CUSTOM_PLAN";
  title: string;
  content: string;
  sceneKey: string;
  turnNumber: number;
};

export type OpenNovelConfirmedManeuverFactV1 = {
  factKey: string;
  content: string;
  sourceResultId: string;
};

export type OpenNovelConfirmedManeuverContextV1 = {
  schemaVersion: typeof OPENOVEL_CONFIRMED_MANEUVER_CONTEXT_SCHEMA;
  instruction: string;
  preparedAtTurnNumber: number;
  sourceResultIds: string[];
  summaries: OpenNovelConfirmedManeuverSummaryV1[];
  visibleFacts: OpenNovelConfirmedManeuverFactV1[];
  consumedLeverageKeys: string[];
};

export type ParsedOpenNovelConfirmedManeuverActionV1 = {
  playerAction: string;
  payloadJson: string;
  signature: string;
  context: OpenNovelConfirmedManeuverContextV1;
};

export function appendOpenNovelConfirmedManeuverContext(
  playerActionValue: unknown,
  context: OpenNovelConfirmedManeuverContextV1,
  signatureValue: unknown,
) {
  const playerAction = String(playerActionValue || "").trim();
  const signature = String(signatureValue || "").trim();
  const payloadJson = JSON.stringify(context);
  return `${playerAction}\n\n<${OPENOVEL_CONFIRMED_MANEUVER_CONTEXT_TAG} signature="${signature}">\n${payloadJson}\n</${OPENOVEL_CONFIRMED_MANEUVER_CONTEXT_TAG}>`;
}

export function parseOpenNovelConfirmedManeuverAction(
  rawValue: unknown,
): ParsedOpenNovelConfirmedManeuverActionV1 | null {
  const raw = String(rawValue || "").trim();
  const closing = `</${OPENOVEL_CONFIRMED_MANEUVER_CONTEXT_TAG}>`;
  if (!raw.endsWith(closing)) return null;
  const openingPrefix = `<${OPENOVEL_CONFIRMED_MANEUVER_CONTEXT_TAG} signature="`;
  const openingStart = raw.lastIndexOf(`\n\n${openingPrefix}`);
  if (openingStart < 0) return null;
  const signatureStart = openingStart + 2 + openingPrefix.length;
  const signatureEnd = raw.indexOf('">\n', signatureStart);
  if (signatureEnd < 0) return null;
  const payloadStart = signatureEnd + 3;
  const payloadEnd = raw.length - closing.length - 1;
  if (payloadEnd < payloadStart) return null;
  const playerAction = raw.slice(0, openingStart).trim();
  const signature = raw.slice(signatureStart, signatureEnd).trim();
  const payloadJson = raw.slice(payloadStart, payloadEnd).trim();
  let context: unknown;
  try {
    context = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!isOpenNovelConfirmedManeuverContext(context)) return null;
  return { playerAction, payloadJson, signature, context };
}

export function isOpenNovelConfirmedManeuverContext(
  value: unknown,
): value is OpenNovelConfirmedManeuverContextV1 {
  const source = record(value);
  if (source.schemaVersion !== OPENOVEL_CONFIRMED_MANEUVER_CONTEXT_SCHEMA) return false;
  if (!String(source.instruction || "").trim()) return false;
  if (!Number.isInteger(Number(source.preparedAtTurnNumber)) || Number(source.preparedAtTurnNumber) < 0) return false;
  if (!stringArray(source.sourceResultIds)) return false;
  if (!stringArray(source.consumedLeverageKeys)) return false;
  if (!Array.isArray(source.summaries) || !source.summaries.every((item) => {
    const summary = record(item);
    return Boolean(
      String(summary.resultId || "").trim()
      && ["CONVERSATION", "INVESTIGATION", "LEVERAGE", "CUSTOM_PLAN"].includes(String(summary.decisionForm || ""))
      && String(summary.title || "").trim()
      && String(summary.content || "").trim()
      && String(summary.sceneKey || "").trim()
      && Number.isInteger(Number(summary.turnNumber))
      && Number(summary.turnNumber) >= 0
    );
  })) return false;
  if (!Array.isArray(source.visibleFacts) || !source.visibleFacts.every((item) => {
    const fact = record(item);
    return Boolean(
      String(fact.factKey || "").trim()
      && String(fact.content || "").trim()
      && String(fact.sourceResultId || "").trim()
    );
  })) return false;
  return true;
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
