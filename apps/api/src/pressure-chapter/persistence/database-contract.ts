import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import { createHash } from "node:crypto";

const SAFE_DATABASE_MARKER = /(?:^|[-_.])(test|testing|ci|dev|development|local)(?:$|[-_.])/i;
const UNSAFE_HOST_MARKER = /(?:^|\.)(prod|production)(?:\.|$)/i;

export interface SafePressureDatabaseScopeV1 {
  databaseUrl: string;
  host: string;
  databaseName: string;
  explicitScope: "non-production";
  supabaseProjectFingerprint: string | null;
}

/**
 * DB-contract tests require both an explicit scope declaration and a visibly
 * non-production database/host marker. This is checked before Prisma exists.
 */
export function assertSafePressureDatabaseScope(input: {
  databaseUrl: string | undefined;
  explicitScope: string | undefined;
  allowedSupabaseProjectSha256?: string | undefined;
}): SafePressureDatabaseScopeV1 {
  if (!input.databaseUrl?.trim()) unsafe("DATABASE_URL_MISSING");
  const normalizedScope = input.explicitScope?.trim().toLowerCase().replaceAll("_", "-");
  if (normalizedScope !== "non-production") {
    unsafe("PRESSURE_CHAPTER_DB_SCOPE_MUST_BE_NON_PRODUCTION");
  }
  let parsed: URL;
  try {
    parsed = new URL(input.databaseUrl);
  } catch {
    unsafe("DATABASE_URL_INVALID");
  }
  if (parsed!.protocol !== "postgres:" && parsed!.protocol !== "postgresql:") {
    unsafe("POSTGRES_REQUIRED");
  }
  const databaseName = decodeURIComponent(parsed!.pathname.replace(/^\//, ""));
  if (UNSAFE_HOST_MARKER.test(parsed!.hostname)) {
    unsafe("DATABASE_NOT_VISIBLY_NON_PRODUCTION");
  }
  const projectRef = extractSupabaseProjectRef(parsed!);
  let supabaseProjectFingerprint: string | null = null;
  if (projectRef !== null) {
    const allowed = input.allowedSupabaseProjectSha256?.trim().toLowerCase();
    if (!allowed || !/^[0-9a-f]{64}$/.test(allowed)) {
      unsafe("SUPABASE_PROJECT_ALLOWLIST_REQUIRED");
    }
    supabaseProjectFingerprint = createHash("sha256").update(projectRef, "utf8").digest("hex");
    if (supabaseProjectFingerprint !== allowed) {
      unsafe("SUPABASE_PROJECT_NOT_ALLOWLISTED");
    }
  } else {
    const safeMarker = SAFE_DATABASE_MARKER.test(databaseName)
      || SAFE_DATABASE_MARKER.test(parsed!.hostname);
    if (!safeMarker) unsafe("DATABASE_NOT_VISIBLY_NON_PRODUCTION");
  }
  return {
    databaseUrl: input.databaseUrl,
    host: parsed!.hostname,
    databaseName,
    explicitScope: "non-production",
    supabaseProjectFingerprint,
  };
}

function extractSupabaseProjectRef(parsed: URL): string | null {
  const direct = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(parsed.hostname)?.[1];
  if (direct) return direct.toLowerCase();
  if (/\.pooler\.supabase\.com$/i.test(parsed.hostname)) {
    const username = decodeURIComponent(parsed.username);
    const pooler = /^postgres\.([a-z0-9-]+)$/i.exec(username)?.[1];
    if (pooler) return pooler.toLowerCase();
    unsafe("SUPABASE_PROJECT_REF_MISSING");
  }
  return null;
}

function unsafe(reason: string): never {
  throw new PressurePersistenceError(
    ERROR.UNSAFE_DATABASE_SCOPE,
    `Pressure DB contract runner refused unsafe scope: ${reason}`,
    { reason },
  );
}
