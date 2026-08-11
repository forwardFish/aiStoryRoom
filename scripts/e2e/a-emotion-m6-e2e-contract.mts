import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { basename, isAbsolute } from "node:path";

export const A_EMOTION_E2E_ROLE_KEYS = [
  "zhejiang_governor",
  "xunfu",
  "county_magistrate"
] as const;

export type AEmotionE2ERoleKey = typeof A_EMOTION_E2E_ROLE_KEYS[number];

export const A_EMOTION_E2E_ACTION_IDS = {
  hiddenCopyOnly: "main_s2_xunfu_seize_drafts",
  suspectedInvestigation: "main_s2_governor_dual_verification",
  confirmedEvidence: "main_s4_governor_seal_evidence"
} as const;

export const A_EMOTION_E2E_PROMISE_CODE = "DELIVER_ORIGINAL_LEDGER" as const;
export const A_EMOTION_E2E_PROMISE_OBJECT = "original-grain-ledger" as const;

export const A_EMOTION_M4_PROMISE_COMMAND_SCHEMA_VERSION = "a_emotion_m4_simple_promise_command_v1" as const;
export const A_EMOTION_E2E_SHORT_REQUEST_TIMEOUT_MS = 30_000;
export const A_EMOTION_E2E_MODEL_REQUEST_TIMEOUT_MS = 120_000;
export const A_EMOTION_E2E_GENERATION_POLL_DEADLINE_MS = 240_000;

export type AEmotionE2ESimplePromiseCommand = {
  schemaVersion: typeof A_EMOTION_M4_PROMISE_COMMAND_SCHEMA_VERSION;
  idempotencyKey: string;
  promiseCode: typeof A_EMOTION_E2E_PROMISE_CODE;
  targetRoleKey: AEmotionE2ERoleKey;
  expectedStage: number;
};

const E2E_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/u;

export function buildAEmotionE2ESimplePromiseCommand(input: {
  idempotencyKey: string;
  promiseCode: typeof A_EMOTION_E2E_PROMISE_CODE;
  targetRoleKey: AEmotionE2ERoleKey;
  expectedStage: number;
}): AEmotionE2ESimplePromiseCommand {
  if (!E2E_IDEMPOTENCY_KEY.test(input.idempotencyKey)) throw new Error("invalid E2E promise idempotency key");
  if (!A_EMOTION_E2E_ROLE_KEYS.includes(input.targetRoleKey)) throw new Error("invalid E2E promise target role");
  if (!Number.isSafeInteger(input.expectedStage) || input.expectedStage < 1) throw new Error("invalid E2E promise stage");
  return {
    schemaVersion: A_EMOTION_M4_PROMISE_COMMAND_SCHEMA_VERSION,
    idempotencyKey: input.idempotencyKey,
    promiseCode: input.promiseCode,
    targetRoleKey: input.targetRoleKey,
    expectedStage: input.expectedStage
  };
}

export function isStoryGenerationInProgress(status: number, code: string): boolean {
  return status === 503 && code === "STORY_GENERATION_IN_PROGRESS";
}

export function generationTimeoutDiagnostic(input: {
  status: number | "TRANSPORT_TIMEOUT";
  code: string;
  roomId: string;
  turnId: string;
  polls: number;
  lastState: Record<string, unknown> | null;
}) {
  return {
    status: input.status,
    code: input.code,
    roomHash: hashIdentifier(input.roomId, 12),
    turnHash: hashIdentifier(input.turnId, 12),
    polls: Math.max(0, Math.trunc(input.polls)),
    lastState: sanitizeEvidence(input.lastState || {})
  };
}

export const A_EMOTION_E2E_CHECKPOINT_IDS = [
  "E2E-01", "E2E-02", "E2E-03", "E2E-04", "E2E-05",
  "E2E-06", "E2E-07", "E2E-08", "E2E-09", "E2E-10"
] as const;

export const A_EMOTION_E2E_RUNTIME_MARKERS = [
  "FEED_10",
  "HISTORY_100",
  "POLL_FALLBACK_7000MS",
  "SSE_BURST_5",
  "AGGREGATED_DOM_BOUNDED",
  "ACTIVE_INPUT_PRESERVED"
] as const;

export type AEmotionE2ECheckpointId = typeof A_EMOTION_E2E_CHECKPOINT_IDS[number];
export type CheckpointStatus = "PASS" | "FAIL" | "NOT_RUN";

export type AEmotionE2ECheckpoint = {
  id: AEmotionE2ECheckpointId;
  status: CheckpointStatus;
  startedAt: string;
  finishedAt: string;
  assertions: number;
  evidenceFiles: string[];
  message: string;
};

export type AEmotionE2EPlayerState = {
  role: AEmotionE2ERoleKey;
  storageState: string;
  userId: string;
};

export type AEmotionE2ERuntimeDescriptor = {
  schemaVersion: "a_emotion_m6_e2e_runtime_v1";
  runId: string;
  roomId: string;
  baseUrl: string;
  apiBaseUrl: string;
  evidenceDir: string;
  playerStatesFile: string;
  users: Record<AEmotionE2ERoleKey, { userId: string }>;
};

export type PnpmTransport = {
  program: string;
  prefixArgs: string[];
  source: "npm_execpath";
};

const SECRET_KEY = /(authorization|cookie|token|secret|password|storageState|session|apiKey|privateKey|credential|databaseUrl|connectionString)/iu;
const PRIVATE_URL_QUERY = /(password|token|secret|key|apikey|access_token|refresh_token)/iu;
const FORBIDDEN_NETWORK_KEYS = new Set([
  "sourceRoleId", "sourceRoleKey", "sourceRoleName", "sourceActorId", "sourceActorName",
  "sourceActionId", "playerActionId", "rawAction", "actionJson", "rawAudience",
  "audienceRoleIds", "audienceUserIds", "dedupeKey", "internalDedupeKey",
  "canonicalPayload", "privatePayload", "internalPayload", "stateJson"
]);

export function requireNonProductionSupabaseUrl(raw: string | undefined, confirmation: string | undefined): URL {
  const value = String(raw || "").trim();
  if (!value) throw new Error("A_EMOTION_M6_E2E_SUPABASE_URL (or A_EMOTION_M6_SUPABASE_URL) is required");
  if (confirmation !== "I_ACKNOWLEDGE_NON_PROD") {
    throw new Error("A_EMOTION_M6_NONPROD_CONFIRM must equal I_ACKNOWLEDGE_NON_PROD");
  }
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    throw new Error("Local PostgreSQL is not accepted by the real Supabase E2E gate");
  }
  const officialSupabaseHost = host.endsWith(".supabase.co")
    || host.endsWith(".supabase.net")
    || host === "pooler.supabase.com"
    || host.endsWith(".pooler.supabase.com");
  if (!officialSupabaseHost) throw new Error("The E2E database URL must target an official Supabase PostgreSQL host");
  const markers = `${url.pathname} ${url.searchParams.get("options") || ""} ${url.searchParams.get("application_name") || ""}`;
  if (/(^|[^a-z])(prod|production|public)([^a-z]|$)/iu.test(markers)) {
    throw new Error("Production/public database markers are forbidden");
  }
  if (!url.username || !url.password) throw new Error("Supabase PostgreSQL credentials are required in the caller environment");
  return url;
}

/**
 * Resolve pnpm without asking Windows to execute the pnpm shim directly.
 * A pnpm-started script provides npm_execpath; Node can safely execute that
 * JavaScript entrypoint with an argument array on every supported platform.
 */
export function resolvePnpmTransport(
  env: NodeJS.ProcessEnv = process.env,
  nodeExecutable = process.execPath
): PnpmTransport {
  const npmExecPath = String(env.npm_execpath || "").trim();
  if (!npmExecPath) throw new Error("PNPM_TRANSPORT_UNAVAILABLE: npm_execpath is required; start this gate through pnpm");
  const name = npmExecPath.replaceAll("\\", "/").split("/").at(-1)!.toLowerCase();
  if (!/^pnpm(?:\.c?m?js)?$/u.test(name) && !name.startsWith("pnpm.")) {
    throw new Error("PNPM_TRANSPORT_UNAVAILABLE: npm_execpath is not a pnpm entrypoint");
  }
  const absoluteNode = isAbsolute(nodeExecutable) || /^[A-Za-z]:[\\/]/u.test(nodeExecutable);
  if (!nodeExecutable || !absoluteNode) throw new Error("PNPM_TRANSPORT_UNAVAILABLE: process.execPath must be absolute");
  return { program: nodeExecutable, prefixArgs: [npmExecPath], source: "npm_execpath" };
}

export function pnpmInvocation(transport: PnpmTransport, args: readonly string[]) {
  return { program: transport.program, args: [...transport.prefixArgs, ...args] };
}

export function createRandomSchema(prefix = "aemotion_m6_e2e"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function scopedDatabaseUrl(base: URL, schema: string): string {
  assert.match(schema, /^[a-z][a-z0-9_]{7,62}$/u, "invalid random schema name");
  const scoped = new URL(base.toString());
  scoped.searchParams.set("schema", schema);
  return scoped.toString();
}

export function assertExactRoles(values: readonly string[]): asserts values is readonly AEmotionE2ERoleKey[] {
  assert.deepEqual(new Set(values), new Set(A_EMOTION_E2E_ROLE_KEYS), "E2E must use governor/xunfu/county_magistrate exactly once");
}

export function findForbiddenNetworkPaths(value: unknown, path = "$", output: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findForbiddenNetworkPaths(entry, `${path}[${index}]`, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const next = `${path}.${key}`;
    if (FORBIDDEN_NETWORK_KEYS.has(key)) output.push(next);
    findForbiddenNetworkPaths(nested, next, output);
  }
  return output;
}

export function hashIdentifier(value: string, length = 16): string {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, Math.max(8, Math.min(64, length)));
}

export function redactDynamicApiPath(rawPath: string): string {
  const [pathname, query = ""] = String(rawPath || "").split("?", 2);
  const segments = pathname.split("/").map((segment, index, values) => {
    if (!segment) return segment;
    const previous = values[index - 1] || "";
    const routeIdParent = ["rooms", "turns", "events", "modals", "interactions", "tasks", "users"].includes(previous);
    const opaque = segment.length >= 16 && /^[A-Za-z0-9._:-]+$/u.test(segment);
    return routeIdParent || opaque ? `id-${hashIdentifier(segment, 12)}` : segment;
  });
  const safeQuery = query
    ? `?${Array.from(new URLSearchParams(query).keys()).sort().map((key) => `${encodeURIComponent(key)}=[REDACTED]`).join("&")}`
    : "";
  return `${segments.join("/")}${safeQuery}`;
}

export function sanitizeEvidence<T>(value: T, knownSecrets: readonly string[] = []): T {
  const secretValues = knownSecrets.filter((item) => item.length >= 6);
  const visit = (input: unknown, key = ""): unknown => {
    if (SECRET_KEY.test(key)) return "[REDACTED]";
    if (typeof input === "string") {
      let text = input;
      for (const secret of secretValues) text = text.replaceAll(secret, "[REDACTED]");
      if (/^https?:\/\//iu.test(text) || /^postgres(?:ql)?:\/\//iu.test(text)) text = sanitizeUrl(text);
      text = text.replace(/\b(?:room|run|user|row|event|delivery|modal|task|action|turn|role)[-_][A-Za-z0-9._:-]{8,}\b/giu, (match) => `id-${hashIdentifier(match, 12)}`);
      return text.length > 8_000 ? `${text.slice(0, 8_000)}…[TRUNCATED]` : text;
    }
    if (Array.isArray(input)) return input.map((entry) => visit(entry));
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([name, nested]) => [name, visit(nested, name)]));
  };
  return visit(value) as T;
}

export function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username) url.username = "redacted";
    if (url.password) url.password = "redacted";
    for (const key of [...url.searchParams.keys()]) if (PRIVATE_URL_QUERY.test(key)) url.searchParams.set(key, "redacted");
    return url.toString();
  } catch {
    return raw.replace(/(Bearer\s+)[A-Za-z0-9._~-]+/giu, "$1[REDACTED]");
  }
}

export function safeEvidenceName(input: string): string {
  const name = basename(input).replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!name || name === "." || name === "..") throw new Error("unsafe evidence filename");
  return name.slice(0, 120);
}

export function sha256Text(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function checkpoint(
  id: AEmotionE2ECheckpointId,
  status: CheckpointStatus,
  startedAt: Date,
  assertions: number,
  evidenceFiles: string[],
  message: string
): AEmotionE2ECheckpoint {
  return {
    id,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    assertions,
    evidenceFiles: evidenceFiles.map(safeEvidenceName),
    message
  };
}

export function isUnsafeArchivePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("/")
    || /^[A-Za-z]:\//u.test(normalized)
    || normalized.split("/").includes("..")
    || /(^|\/)(?:\.git|node_modules|dist|build|\.env(?:\.[^/]*)?|storageState(?:\.[^/]*)?|cookies?(?:\.[^/]*)?)(?:\/|$)/iu.test(normalized);
}
