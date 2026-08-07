import { createHmac, timingSafeEqual } from "node:crypto";
import { actionConflict, actionRejected } from "./runtime-errors.js";
import {
  clearConfirmedManeuverRuntimeContext,
  stageConfirmedManeuverRuntimeContext,
  type RuntimeConfirmedManeuverContextV1,
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
    }
    if (
      input.expectedStateRevision !== undefined
      && input.expectedStateRevision !== input.currentStateRevision
    ) {
      throw actionConflict("STATE_REVISION_CONFLICT");
    }

    if (decorated) {
      stageConfirmedManeuverRuntimeContext({
        runId: input.runId,
        stateRevision: input.currentStateRevision,
        context: decorated.context,
      });
    } else {
      clearConfirmedManeuverRuntimeContext(input.runId, input.currentStateRevision);
    }
    return {
      runId: input.runId,
      // Transport metadata never reaches action matching, settlement, history,
      // chapter text or the public result. Only ContextCompiler receives it.
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
  const context = normalizeContext(payload);
  return context ? { playerAction, signature, payloadJson, context } : null;
}

function normalizeContext(value: unknown): RuntimeConfirmedManeuverContextV1 | null {
  const source = record(value);
  if (source.schemaVersion !== "openovel_confirmed_maneuver_context_v1") return null;
  const instruction = String(source.instruction || "").trim();
  const preparedAtTurnNumber = Number(source.preparedAtTurnNumber);
  const sourceResultIds = stringArray(source.sourceResultIds, false);
  const consumedLeverageKeys = stringArray(source.consumedLeverageKeys, true);
  if (!instruction || !Number.isInteger(preparedAtTurnNumber) || preparedAtTurnNumber < 0) return null;
  if (!sourceResultIds || !consumedLeverageKeys) return null;

  const summaries = Array.isArray(source.summaries)
    ? source.summaries.map((item) => {
        const summary = record(item);
        const decisionForm = String(summary.decisionForm || "");
        if (
          !String(summary.resultId || "").trim()
          || !["CONVERSATION", "INVESTIGATION", "LEVERAGE", "CUSTOM_PLAN"].includes(decisionForm)
          || !String(summary.title || "").trim()
          || !String(summary.content || "").trim()
          || !String(summary.sceneKey || "").trim()
          || !Number.isInteger(Number(summary.turnNumber))
          || Number(summary.turnNumber) < 0
        ) return null;
        return {
          resultId: String(summary.resultId),
          decisionForm: decisionForm as RuntimeConfirmedManeuverContextV1["summaries"][number]["decisionForm"],
          title: String(summary.title),
          content: String(summary.content),
          sceneKey: String(summary.sceneKey),
          turnNumber: Number(summary.turnNumber),
        };
      })
    : [];
  if (!summaries.length || summaries.some((item) => !item)) return null;

  const visibleFacts = Array.isArray(source.visibleFacts)
    ? source.visibleFacts.map((item) => {
        const fact = record(item);
        if (
          !String(fact.factKey || "").trim()
          || !String(fact.content || "").trim()
          || !String(fact.sourceResultId || "").trim()
        ) return null;
        return {
          factKey: String(fact.factKey),
          content: String(fact.content),
          sourceResultId: String(fact.sourceResultId),
        };
      })
    : [];
  if (visibleFacts.some((item) => !item)) return null;

  return {
    schemaVersion: "openovel_confirmed_maneuver_context_v1",
    instruction,
    preparedAtTurnNumber,
    sourceResultIds,
    summaries: summaries as RuntimeConfirmedManeuverContextV1["summaries"],
    visibleFacts: visibleFacts as RuntimeConfirmedManeuverContextV1["visibleFacts"],
    consumedLeverageKeys,
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

function stringArray(value: unknown, allowEmpty: boolean) {
  if (!Array.isArray(value)) return null;
  const result = value.map((item) => String(item || "").trim());
  if ((!allowEmpty && !result.length) || result.some((item) => !item)) return null;
  return result;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
