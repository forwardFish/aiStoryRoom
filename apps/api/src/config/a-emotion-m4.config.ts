import {
  A_EMOTION_M4_TERMS_SCHEMA_VERSION,
  validateAEmotionSimplePromiseTermsV1,
  type AEmotionSimplePromiseCodeV1,
  type AEmotionSimplePromiseTermsV1
} from "@ai-story/shared";
import { isAEmotionM2EnabledForRun } from "./a-emotion-m2.config";
import type { AEmotionM1RunGate } from "./a-emotion-m1.config";
import { frozenAEmotionCapability } from "./a-emotion-room-flags";
import { aEmotionSangtianPromiseBreakCodes, aEmotionSangtianPromiseRevealFactCodes } from "./a-emotion-sangtian-lifecycle.config";

export type AEmotionM4RunGate = AEmotionM1RunGate;

const SANGTIAN_LEDGER_BREAK_CODES = aEmotionSangtianPromiseBreakCodes();
const SANGTIAN_LEDGER_REVEAL_FACT_CODES = aEmotionSangtianPromiseRevealFactCodes();

const PROMISE_TERMS: Record<AEmotionSimplePromiseCodeV1, AEmotionSimplePromiseTermsV1> = {
  DELIVER_ORIGINAL_LEDGER: {
    schemaVersion: A_EMOTION_M4_TERMS_SCHEMA_VERSION,
    obligationCode: "DELIVER_ORIGINAL_DOCUMENT",
    relatedObjectId: "original-grain-ledger",
    deadlineStage: 4,
    fulfillActionCodes: ["DELIVER_ORIGINAL_LEDGER"],
    fulfillEffectCodes: ["ORIGINAL_LEDGER_DELIVERED"],
    fulfillFactCodes: ["ORIGINAL_LEDGER_DELIVERY_CONFIRMED"],
    breakActionCodes: ["WITHHOLD_ORIGINAL_LEDGER", "DELIVER_LEDGER_COPY_ONLY", ...SANGTIAN_LEDGER_BREAK_CODES.actionCodes],
    breakEffectCodes: ["ORIGINAL_LEDGER_WITHHELD", "LEDGER_COPY_SUBSTITUTED", ...SANGTIAN_LEDGER_BREAK_CODES.effectCodes],
    breakFactCodes: ["ORIGINAL_LEDGER_NOT_DELIVERED", ...SANGTIAN_LEDGER_BREAK_CODES.factCodes],
    revealEvidenceFactCodes: ["LEDGER_DELIVERY_CHAIN_CONFIRMED", "PROMISE_LEDGER_BREACH_CONFIRMED", ...SANGTIAN_LEDGER_REVEAL_FACT_CODES],
    expiryOutcome: "BROKEN"
  },
  DO_NOT_PUBLICLY_BLAME: {
    schemaVersion: A_EMOTION_M4_TERMS_SCHEMA_VERSION,
    obligationCode: "AVOID_PUBLIC_BLAME",
    relatedObjectId: null,
    deadlineStage: 6,
    fulfillActionCodes: [],
    fulfillEffectCodes: [],
    fulfillFactCodes: ["NO_PUBLIC_BLAME_UNTIL_DEADLINE"],
    breakActionCodes: ["PUBLICLY_BLAME_TARGET"],
    breakEffectCodes: ["PUBLIC_BLAME_TARGET"],
    breakFactCodes: ["PUBLIC_BLAME_RECORDED"],
    revealEvidenceFactCodes: ["PUBLIC_BLAME_RECORD_CONFIRMED"],
    expiryOutcome: "FULFILLED"
  },
  TESTIFY_FOR_TARGET: {
    schemaVersion: A_EMOTION_M4_TERMS_SCHEMA_VERSION,
    obligationCode: "TESTIFY_FOR_TARGET",
    relatedObjectId: null,
    deadlineStage: 7,
    fulfillActionCodes: ["TESTIFY_FOR_TARGET"],
    fulfillEffectCodes: ["SUPPORTING_TESTIMONY_RECORDED"],
    fulfillFactCodes: ["TESTIMONY_FOR_TARGET_CONFIRMED"],
    breakActionCodes: ["REFUSE_TESTIMONY_FOR_TARGET", "TESTIFY_AGAINST_TARGET"],
    breakEffectCodes: ["TESTIMONY_WITHHELD", "ADVERSE_TESTIMONY_RECORDED"],
    breakFactCodes: ["TESTIMONY_PROMISE_BROKEN"],
    revealEvidenceFactCodes: ["TESTIMONY_RECORD_CONFIRMED"],
    expiryOutcome: "BROKEN"
  }
};

export function aEmotionM4Terms(code: AEmotionSimplePromiseCodeV1): AEmotionSimplePromiseTermsV1 {
  const terms = PROMISE_TERMS[code];
  const validated = validateAEmotionSimplePromiseTermsV1(terms);
  if (!validated.ok) throw new Error(`A_EMOTION_M4_TERMS_INVALID:${validated.errors.join("|")}`);
  return structuredClone(validated.value);
}

export function readAEmotionM4Config(env: NodeJS.ProcessEnv = process.env) {
  return {
    masterEnabled: strictBoolean(env.A_EMOTION_M4_ENABLED, false, "A_EMOTION_M4_ENABLED"),
    simplePromiseEnabled: strictBoolean(env.A_EMOTION_SIMPLE_PROMISE_ENABLED, false, "A_EMOTION_SIMPLE_PROMISE_ENABLED")
  };
}

export function shouldFreezeAEmotionM4ForNewRun(input: {
  processEnabled: boolean;
  simplePromiseEnabled: boolean;
  m2Enabled: boolean;
  templateKey: string;
  mode: string;
  maxPlayers: number;
}) {
  return input.processEnabled && input.simplePromiseEnabled && input.m2Enabled
    && input.templateKey === "sangtian" && input.mode === "room" && input.maxPlayers > 1;
}

export function isAEmotionM4EnabledForRun(run: AEmotionM4RunGate, env: NodeJS.ProcessEnv = process.env) {
  if (!isAEmotionM2EnabledForRun(run, env)) return false;
  const frozen = frozenAEmotionCapability(run.stateJson, "simplePromiseEnabled");
  if (frozen !== null) return frozen;
  const config = readAEmotionM4Config(env);
  if (!config.masterEnabled || !config.simplePromiseEnabled) return false;
  const flags = record(record(run.stateJson).featureFlags);
  return flags.aEmotionM4 === true && flags.aEmotionSimplePromise === true;
}

function strictBoolean(raw: string | undefined, fallback: boolean, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
