import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Canonical } from "@ai-story/shared";

const DEFAULT_RELEASE_ROOT = resolve(
  __dirname,
  "../../../config/sangtian/pressure-chapter-v1/release",
);
const ARTIFACT_ID = "a_emotion_lifecycle_bindings" as const;
const ARTIFACT_PATH = "a-emotion-lifecycle-bindings.json" as const;
const ARTIFACT_VERSION = "sangtian-a-emotion-lifecycle-1.0.0" as const;
export const SANGTIAN_A_EMOTION_LIFECYCLE_BINDINGS_SHA256_V1 =
  "247169a562849e15da74987c39a4f0456ced5e9310707a51a571bad1831a622b" as const;

export interface SangtianAEmotionDisclosureTransitionBindingV1 {
  bindingId: string;
  fromDisclosure: "HIDDEN" | "SUSPECTED";
  toDisclosure: "SUSPECTED" | "CONFIRMED";
  actionCode: string;
  effectCode: string;
  factCode: string;
  suspectedSeatIds: Array<"zhejiang_administration">;
  requiresAuthorizedEvidence: boolean;
}

export interface SangtianAEmotionLifecycleBindingsV1 {
  schemaVersion: "sangtian_a_emotion_lifecycle_bindings_v1";
  bindingVersion: typeof ARTIFACT_VERSION;
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
  canonicalRoles: {
    promiseIssuerSeatId: "zhejiang_administration";
    promiseReceiverSeatId: "zhejiang_governor";
    investigatorSeatId: "qingliu_law";
  };
  formalPromise: {
    entry: "TALK";
    sharedObjectId: "original-grain-ledger";
    maxPerIssuerPerRun: 1;
    promiseCodes: ["DELIVER_ORIGINAL_LEDGER", "DO_NOT_PUBLICLY_BLAME", "TESTIFY_FOR_TARGET"];
    deliverOriginalLedgerOperations: Array<{
      operationCode:
        | "PROMISE_DELIVER_ORIGINAL_FULFILL"
        | "PROMISE_DELIVER_COPY_BREAK"
        | "PROMISE_HIDE_OR_DELAY_BREAK";
      commitmentOperation: "FULFILL" | "BREAK";
    }>;
    genericDeliverLedgerMayInferOriginal: false;
    brokenImpliesRevealed: false;
  };
  disclosureLifecycle: {
    sharedObjectId: "original-grain-ledger";
    rootEventCode: "LEDGER_DELIVERY_ANOMALY";
    transitions: SangtianAEmotionDisclosureTransitionBindingV1[];
  };
  authorityBoundary: {
    promiseAuthority: "WORKING_LEDGER_COMMITMENT_MUTATION";
    aEmotionRole: "POST_COMMIT_CONSUMER_ONLY";
    providerCallsAllowed: false;
    freeTextInferenceAllowed: false;
    frozenWorldFactMutationAllowed: false;
  };
}

export interface PublishedSangtianAEmotionLifecycleBindingsV1 {
  releaseRoot: string;
  artifactSha256: typeof SANGTIAN_A_EMOTION_LIFECYCLE_BINDINGS_SHA256_V1;
  bindings: SangtianAEmotionLifecycleBindingsV1;
}

export class SangtianAEmotionLifecycleBindingsError extends Error {
  readonly name = "SangtianAEmotionLifecycleBindingsError";
  constructor(readonly code: string, readonly path: string) {
    super(`${code}:${path}`);
  }
}

export function loadPublishedSangtianAEmotionLifecycleBindingsV1(
  options: Readonly<{ releaseRoot?: string }> = {},
): PublishedSangtianAEmotionLifecycleBindingsV1 {
  const releaseRoot = resolve(options.releaseRoot ?? DEFAULT_RELEASE_ROOT);
  const manifest = object(readJson(resolve(releaseRoot, "release-manifest.json")), "manifest");
  const artifacts = array(manifest.artifacts, "manifest.artifacts");
  const matches = artifacts.map((value, index) => object(value, `manifest.artifacts[${index}]`))
    .filter((value) => value.artifactId === ARTIFACT_ID);
  const pinned = matches[0];
  if (
    matches.length !== 1
    || pinned?.path !== ARTIFACT_PATH
    || pinned.version !== ARTIFACT_VERSION
    || pinned.hashMode !== "CANONICAL_JSON"
    || pinned.sha256 !== SANGTIAN_A_EMOTION_LIFECYCLE_BINDINGS_SHA256_V1
  ) fail("MANIFEST_INVALID", `manifest.artifacts.${ARTIFACT_ID}`);
  const raw = readJson(resolve(releaseRoot, ARTIFACT_PATH));
  if (sha256Canonical(raw) !== SANGTIAN_A_EMOTION_LIFECYCLE_BINDINGS_SHA256_V1) {
    fail("ARTIFACT_HASH_MISMATCH", ARTIFACT_PATH);
  }
  return deepFreeze({
    releaseRoot,
    artifactSha256: SANGTIAN_A_EMOTION_LIFECYCLE_BINDINGS_SHA256_V1,
    bindings: validateSangtianAEmotionLifecycleBindingsV1(raw),
  });
}

export function validateSangtianAEmotionLifecycleBindingsV1(
  value: unknown,
): SangtianAEmotionLifecycleBindingsV1 {
  const root = object(value, "bindings");
  exact(root, [
    "schemaVersion", "bindingVersion", "runtimeProfile", "canonicalRoles",
    "formalPromise", "disclosureLifecycle", "authorityBoundary",
  ], "bindings");
  literal(root.schemaVersion, "sangtian_a_emotion_lifecycle_bindings_v1", "bindings.schemaVersion");
  literal(root.bindingVersion, ARTIFACT_VERSION, "bindings.bindingVersion");
  literal(root.runtimeProfile, "SANGTIAN_CONTINUOUS_CHAPTER_V1", "bindings.runtimeProfile");

  const roles = object(root.canonicalRoles, "bindings.canonicalRoles");
  exact(roles, ["promiseIssuerSeatId", "promiseReceiverSeatId", "investigatorSeatId"], "bindings.canonicalRoles");
  literal(roles.promiseIssuerSeatId, "zhejiang_administration", "bindings.canonicalRoles.promiseIssuerSeatId");
  literal(roles.promiseReceiverSeatId, "zhejiang_governor", "bindings.canonicalRoles.promiseReceiverSeatId");
  literal(roles.investigatorSeatId, "qingliu_law", "bindings.canonicalRoles.investigatorSeatId");

  const promise = object(root.formalPromise, "bindings.formalPromise");
  exact(promise, [
    "entry", "sharedObjectId", "maxPerIssuerPerRun", "promiseCodes",
    "deliverOriginalLedgerOperations", "genericDeliverLedgerMayInferOriginal",
    "brokenImpliesRevealed",
  ], "bindings.formalPromise");
  literal(promise.entry, "TALK", "bindings.formalPromise.entry");
  literal(promise.sharedObjectId, "original-grain-ledger", "bindings.formalPromise.sharedObjectId");
  literal(promise.maxPerIssuerPerRun, 1, "bindings.formalPromise.maxPerIssuerPerRun");
  exactArray(promise.promiseCodes, [
    "DELIVER_ORIGINAL_LEDGER", "DO_NOT_PUBLICLY_BLAME", "TESTIFY_FOR_TARGET",
  ], "bindings.formalPromise.promiseCodes");
  literal(promise.genericDeliverLedgerMayInferOriginal, false, "bindings.formalPromise.genericDeliverLedgerMayInferOriginal");
  literal(promise.brokenImpliesRevealed, false, "bindings.formalPromise.brokenImpliesRevealed");
  const operations = array(promise.deliverOriginalLedgerOperations, "bindings.formalPromise.deliverOriginalLedgerOperations");
  const expectedOperations = [
    ["PROMISE_DELIVER_ORIGINAL_FULFILL", "FULFILL"],
    ["PROMISE_DELIVER_COPY_BREAK", "BREAK"],
    ["PROMISE_HIDE_OR_DELAY_BREAK", "BREAK"],
  ];
  if (operations.length !== expectedOperations.length) fail("ARTIFACT_INVALID", "bindings.formalPromise.deliverOriginalLedgerOperations");
  operations.forEach((value, index) => {
    const row = object(value, `bindings.formalPromise.deliverOriginalLedgerOperations[${index}]`);
    exact(row, ["operationCode", "commitmentOperation"], `bindings.formalPromise.deliverOriginalLedgerOperations[${index}]`);
    literal(row.operationCode, expectedOperations[index]![0], `bindings.formalPromise.deliverOriginalLedgerOperations[${index}].operationCode`);
    literal(row.commitmentOperation, expectedOperations[index]![1], `bindings.formalPromise.deliverOriginalLedgerOperations[${index}].commitmentOperation`);
  });

  const lifecycle = object(root.disclosureLifecycle, "bindings.disclosureLifecycle");
  exact(lifecycle, ["sharedObjectId", "rootEventCode", "transitions"], "bindings.disclosureLifecycle");
  literal(lifecycle.sharedObjectId, "original-grain-ledger", "bindings.disclosureLifecycle.sharedObjectId");
  literal(lifecycle.rootEventCode, "LEDGER_DELIVERY_ANOMALY", "bindings.disclosureLifecycle.rootEventCode");
  const transitions = array(lifecycle.transitions, "bindings.disclosureLifecycle.transitions");
  if (transitions.length !== 2) fail("ARTIFACT_INVALID", "bindings.disclosureLifecycle.transitions");
  const expectedTransitions = [
    ["HIDDEN", "SUSPECTED", false],
    ["SUSPECTED", "CONFIRMED", true],
  ] as const;
  transitions.forEach((value, index) => {
    const row = object(value, `bindings.disclosureLifecycle.transitions[${index}]`);
    exact(row, [
      "bindingId", "fromDisclosure", "toDisclosure", "actionCode", "effectCode",
      "factCode", "suspectedSeatIds", "requiresAuthorizedEvidence",
    ], `bindings.disclosureLifecycle.transitions[${index}]`);
    for (const key of ["bindingId", "actionCode", "effectCode", "factCode"] as const) text(row[key], `bindings.disclosureLifecycle.transitions[${index}].${key}`);
    literal(row.fromDisclosure, expectedTransitions[index]![0], `bindings.disclosureLifecycle.transitions[${index}].fromDisclosure`);
    literal(row.toDisclosure, expectedTransitions[index]![1], `bindings.disclosureLifecycle.transitions[${index}].toDisclosure`);
    literal(row.requiresAuthorizedEvidence, expectedTransitions[index]![2], `bindings.disclosureLifecycle.transitions[${index}].requiresAuthorizedEvidence`);
    exactArray(row.suspectedSeatIds, index === 0 ? ["zhejiang_administration"] : [], `bindings.disclosureLifecycle.transitions[${index}].suspectedSeatIds`);
  });

  const boundary = object(root.authorityBoundary, "bindings.authorityBoundary");
  exact(boundary, [
    "promiseAuthority", "aEmotionRole", "providerCallsAllowed",
    "freeTextInferenceAllowed", "frozenWorldFactMutationAllowed",
  ], "bindings.authorityBoundary");
  literal(boundary.promiseAuthority, "WORKING_LEDGER_COMMITMENT_MUTATION", "bindings.authorityBoundary.promiseAuthority");
  literal(boundary.aEmotionRole, "POST_COMMIT_CONSUMER_ONLY", "bindings.authorityBoundary.aEmotionRole");
  literal(boundary.providerCallsAllowed, false, "bindings.authorityBoundary.providerCallsAllowed");
  literal(boundary.freeTextInferenceAllowed, false, "bindings.authorityBoundary.freeTextInferenceAllowed");
  literal(boundary.frozenWorldFactMutationAllowed, false, "bindings.authorityBoundary.frozenWorldFactMutationAllowed");
  return structuredClone(root) as unknown as SangtianAEmotionLifecycleBindingsV1;
}

function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fail("READ_FAILED", path); }
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ARTIFACT_INVALID", path);
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail("ARTIFACT_INVALID", path);
  return value;
}
function exact(value: Record<string, unknown>, keys: string[], path: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) fail("ARTIFACT_INVALID", path);
}
function exactArray(value: unknown, expected: readonly unknown[], path: string): void {
  if (!Array.isArray(value) || sha256Canonical(value) !== sha256Canonical(expected)) fail("ARTIFACT_INVALID", path);
}
function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) fail("ARTIFACT_INVALID", path);
}
function text(value: unknown, path: string): void {
  if (typeof value !== "string" || !/\S/u.test(value)) fail("ARTIFACT_INVALID", path);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}
function fail(code: string, path: string): never {
  throw new SangtianAEmotionLifecycleBindingsError(code, path);
}
