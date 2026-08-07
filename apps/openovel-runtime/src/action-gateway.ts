import { createHmac, timingSafeEqual } from "node:crypto";
import { actionConflict, actionRejected } from "./runtime-errors.js";
import {
  stageConfirmedManeuverRuntimeContext,
} from "./confirmed-maneuver-context.js";
import type { BoundOption, OpenNovelOption } from "./types.js";

const CONFIRMED_MANEUVER_TAG = "OPENOVEL_SERVER_CONFIRMED_MANEUVERS_V1";
const PLAYER_ACTION_MAX_LENGTH = 2_000;
const MANEUVER_CONTEXT_MAX_LENGTH = 7_000;
const DECORATED_ACTION_MAX_LENGTH = PLAYER_ACTION_MAX_LENGTH + MANEUVER_CONTEXT_MAX_LENGTH + 500;

export type ActionGatewayInput = {
  runId: string;
  rawAction: unknown;
  expectedStateRevision?: number;
  currentStateRevision: number;
};

export type ValidatedPlayerAction = {
  runId: string;
  action: string;
  stateRevision: number;
};

/**
 * The action gateway owns request-level validation only. It does not settle
 * story facts, choose a beat, or rewrite player intent.
 */
export interface ActionGatewayModule {
  readonly moduleId: string;
  validate(input: ActionGatewayInput): ValidatedPlayerAction;
  resolveBoundOption(
    bound: BoundOption | null,
    options: OpenNovelOption[],
    action: string,
  ): OpenNovelOption | null;
}

export class DefaultActionGateway implements ActionGatewayModule {
  readonly moduleId = "openovel.action-gateway.v1";

  validate(input: ActionGatewayInput): ValidatedPlayerAction {
    const rawAction = String(input.rawAction || "").trim();
    const decorated = parseConfirmedManeuverAction(rawAction);
    if (rawAction.includes(CONFIRMED_MANEUVER_TAG) && !decorated) {
      throw actionRejected("SERVER_CONTEXT_INVALID");
    }
    const playerAction = decorated?.playerAction || rawAction;
    if (!playerAction) throw actionRejected("ACTION_REQUIRED");
    if (playerAction.length > PLAYER_ACTION_MAX_LENGTH) throw actionRejected("ACTION_TOO_LONG");
    if (rawAction.length > DECORATED_ACTION_MAX_LENGTH) throw actionRejected("SERVER_CONTEXT_TOO_LONG");
    if (decorated) {
      if (decorated.payloadJson.length > MANEUVER_CONTEXT_MAX_LENGTH) {
        throw actionRejected("SERVER_CONTEXT_TOO_LONG");
      }
      if (!validSignature(decorated.payloadJson, decorated.signature)) {
        throw actionRejected("SERVER_CONTEXT_INVALID");
      }
      if (decorated.context.preparedAtTurnNumber !== input.currentStateRevision) {
        throw actionConflict("SERVER_CONTEXT_STALE");
      }
      stageConfirmedManeuverRuntimeContext({
        runId: input.runId,
        stateRevision: input.currentStateRevision,
        context: decorated.context,
      });
    }
    if (
      input.expectedStateRevision !== undefined
      && input.expectedStateRevision !== input.currentStateRevision
    ) {
      throw actionConflict("STATE_REVISION_CONFLICT");
    }
    return {
      runId: input.runId,
      // The authoritative context is staged separately. Every downstream
      // action, settlement and audit surface receives the player's real text.
      action: playerAction,
      stateRevision: input.currentStateRevision,
    };
  }

  resolveBoundOption(
    bound: BoundOption | null,
    options: OpenNovelOption[],
    action: string,
  ): OpenNovelOption | null {
    if (!bound) return null;
    const match = options.find((option) => option.id === bound.id && option.label === bound.label);
    if (!match || match.label !== action) return null;
    return match;
  }
}

function parseConfirmedManeuverAction(raw: string) {
  const closing = `</${CONFIRMED_MANEUVER_TAG}>`;
  if (!raw.endsWith(closing)) return null;
  const openingPrefix = `<${CONFIRMED_MANEUVER_TAG} signature="`;
  const openingStart = raw.lastIndexOf(`\n\n${openingPrefix}`);
  if (openingStart < 0) return null;
  const signatureStart = openingStart + 2 + openingPrefix.length;
  const signatureEnd = raw.indexOf('\">\n', signatureStart);
  if (signatureEnd < 0) return null;
  const payloadStart = signatureEnd + 3;
  const payloadEnd = raw.length - closing.length - 1;
  if (payloadEnd < payloadStart) return null;
  const playerAction = raw.slice(0, openingStart).trim();
  const signature = raw.slice(signatureStart, signatureEnd).trim();
  const payloadJson = raw.slice(payloadStart, payloadEnd).trim();
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  const source = record(payload);
  if (source.schemaVersion !== "openovel_confirmed_maneuver_context_v1") return null;
  if (!Array.isArray(source.sourceResultIds) || source.sourceResultIds.length < 1) return null;
  if (!source.sourceResultIds.every((item: unknown) => typeof item === "string" && item.trim())) return null;
  if (!Array.isArray(source.summaries) || !Array.isArray(source.visibleFacts)) return null;
  if (!Array.isArray(source.consumedLeverageKeys)) return null;
  const preparedAtTurnNumber = Number(source.preparedAtTurnNumber);
  if (!Number.isInteger(preparedAtTurnNumber) || preparedAtTurnNumber < 0) return null;
  if (!String(source.instruction || "").trim()) return null;
  const summaries = source.summaries.map((item: unknown) => record(item));
  if (!summaries.every((item) => (
    String(item.resultId || "").trim()
    && String(item.decisionForm || "").trim()
    && String(item.title || "").trim()
    && String(item.content || "").trim()
    && String(item.sceneKey || "").trim()
    && Number.isInteger(Number(item.turnNumber))
  ))) return null;
  const visibleFacts = source.visibleFacts.map((item: unknown) => record(item));
  if (!visibleFacts.every((item) => (
    String(item.factKey || "").trim()
    && String(item.content || "").trim()
    && String(item.sourceResultId || "").trim()
  ))) return null;
  return {
    playerAction,
    signature,
    payloadJson,
    context: {
      schemaVersion: "openovel_confirmed_maneuver_context_v1" as const,
      instruction: String(source.instruction),
      preparedAtTurnNumber,
      sourceResultIds: source.sourceResultIds.map(String),
      summaries: summaries.map((item) => ({
        resultId: String(item.resultId),
        decisionForm: String(item.decisionForm),
        title: String(item.title),
        content: String(item.content),
        sceneKey: String(item.sceneKey),
        turnNumber: Number(item.turnNumber),
      })),
      visibleFacts: visibleFacts.map((item) => ({
        factKey: String(item.factKey),
        content: String(item.content),
        sourceResultId: String(item.sourceResultId),
      })),
      consumedLeverageKeys: source.consumedLeverageKeys.map(String),
    },
  };
}

function validSignature(payloadJson: string, supplied: string) {
  const expected = createHmac("sha256", maneuverContextSecret())
    .update(payloadJson)
    .digest("base64url");
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function maneuverContextSecret() {
  const configured = String(process.env.OPENOVEL_INTERNAL_TOKEN || "").trim();
  if (configured.length >= 24) return configured;
  if (process.env.NODE_ENV !== "production") {
    return "openovel-confirmed-maneuver-development-secret-v1";
  }
  throw new Error("OPENOVEL_INTERNAL_TOKEN_REQUIRED_FOR_MANEUVER_CONTEXT");
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
