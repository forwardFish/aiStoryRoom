export interface PressureSupabaseDatabaseReadinessV1 {
  ready: boolean;
  database: "supabase" | "invalid";
  projectRefMatched: boolean;
  reason: string | null;
}

export interface PressureSupabaseDatabaseConfigurationV1
extends PressureSupabaseDatabaseReadinessV1 {
  connectionString: string;
}

export interface PressureDatabasePoolOptionsV1 {
  connectionLimit: number;
  poolTimeoutSeconds: number;
}

const DEFAULT_API_CONNECTION_LIMIT = 5;
const DEFAULT_WORKER_CONNECTION_LIMIT = 1;
const DEFAULT_POOL_TIMEOUT_SECONDS = 20;
const MAX_CONNECTION_LIMIT_PER_PROCESS = 50;
const MAX_POOL_TIMEOUT_SECONDS = 120;

/**
 * Resolve the only database Pressure is allowed to use.
 *
 * The returned diagnostics deliberately contain neither a URL nor a project
 * ref. A Supabase project ref is useful for binding checks, but it does not
 * belong on a public health surface.
 */
export function resolvePressureSupabaseDatabaseV1(
  environment: NodeJS.ProcessEnv,
): PressureSupabaseDatabaseConfigurationV1 {
  const production = environment.NODE_ENV === "production";
  const configuredProjectRef = configuredSupabaseProjectRef(environment);
  const fallback = parseSupabasePostgresUrl(
    environment.SUPABASE_DATABASE_URL,
    "SUPABASE_DATABASE_URL",
  );
  if (!configuredProjectRef) {
    throw configurationError("SUPABASE_PROJECT_REF_REQUIRED");
  }
  if (fallback.projectRef !== configuredProjectRef) {
    throw configurationError("SUPABASE_PROJECT_REF_MISMATCH");
  }

  const explicitValue = clean(environment.DATABASE_URL);
  const explicit = explicitValue ? parseDatabaseUrl(explicitValue, "DATABASE_URL") : null;
  if (production && (!explicit || explicit.kind !== "supabase")) {
    throw configurationError("PRODUCTION_DATABASE_URL_MUST_BE_SUPABASE");
  }
  if (explicit?.kind === "remote-postgres") {
    throw configurationError("REMOTE_POSTGRES_NOT_SUPABASE");
  }
  if (explicit?.kind === "supabase" && explicit.projectRef !== fallback.projectRef) {
    throw configurationError("DATABASE_URL_PROJECT_REF_MISMATCH");
  }

  // Local DATABASE_URL is a legacy developer default. Pressure always selects
  // the explicit Supabase fallback instead; production rejects the local value
  // above so it can never be hidden by this compatibility path.
  const selected = explicit?.kind === "supabase" ? explicit.url : fallback.url;
  if (!selected.searchParams.has("connection_limit")) {
    selected.searchParams.set("connection_limit", "2");
  }
  return {
    ready: true,
    database: "supabase",
    projectRefMatched: true,
    reason: null,
    connectionString: selected.toString(),
  };
}

export function inspectPressureSupabaseDatabaseV1(
  environment: NodeJS.ProcessEnv,
): PressureSupabaseDatabaseReadinessV1 {
  try {
    const resolved = resolvePressureSupabaseDatabaseV1(environment);
    return {
      ready: resolved.ready,
      database: resolved.database,
      projectRefMatched: resolved.projectRefMatched,
      reason: resolved.reason,
    };
  } catch (error) {
    return {
      ready: false,
      database: "invalid",
      projectRefMatched: false,
      reason: error instanceof PressureProductionConfigurationErrorV1
        ? error.code
        : "PRESSURE_DATABASE_CONFIGURATION_INVALID",
    };
  }
}

export function configurePressureSupabaseDatabaseV1(
  environment: NodeJS.ProcessEnv,
  options: { connectionLimit?: number; poolTimeoutSeconds?: number } = {},
): PressureSupabaseDatabaseReadinessV1 {
  const resolved = resolvePressureSupabaseDatabaseV1(environment);
  const connectionString = new URL(resolved.connectionString);
  if (options.connectionLimit !== undefined) {
    if (!Number.isSafeInteger(options.connectionLimit) || options.connectionLimit < 1) {
      throw configurationError("SUPABASE_CONNECTION_LIMIT_INVALID");
    }
    connectionString.searchParams.set("connection_limit", String(options.connectionLimit));
  }
  if (options.poolTimeoutSeconds !== undefined) {
    if (!Number.isSafeInteger(options.poolTimeoutSeconds) || options.poolTimeoutSeconds < 1) {
      throw configurationError("SUPABASE_POOL_TIMEOUT_INVALID");
    }
    connectionString.searchParams.set("pool_timeout", String(options.poolTimeoutSeconds));
  }
  environment.DATABASE_URL = connectionString.toString();
  return {
    ready: true,
    database: "supabase",
    projectRefMatched: true,
    reason: null,
  };
}

export function pressureDatabasePoolOptionsV1(
  environment: NodeJS.ProcessEnv,
  processRole: "api" | "worker",
): PressureDatabasePoolOptionsV1 {
  const connectionLimit = positiveBoundedInteger(
    environment[processRole === "api"
      ? "PRESSURE_API_DATABASE_CONNECTION_LIMIT"
      : "PRESSURE_WORKER_DATABASE_CONNECTION_LIMIT"],
    processRole === "api" ? DEFAULT_API_CONNECTION_LIMIT : DEFAULT_WORKER_CONNECTION_LIMIT,
    MAX_CONNECTION_LIMIT_PER_PROCESS,
    "SUPABASE_CONNECTION_LIMIT_INVALID",
  );
  const poolTimeoutSeconds = positiveBoundedInteger(
    environment.PRESSURE_DATABASE_POOL_TIMEOUT_SECONDS,
    DEFAULT_POOL_TIMEOUT_SECONDS,
    MAX_POOL_TIMEOUT_SECONDS,
    "SUPABASE_POOL_TIMEOUT_INVALID",
  );
  return { connectionLimit, poolTimeoutSeconds };
}

export class PressureProductionConfigurationErrorV1 extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PressureProductionConfigurationErrorV1";
  }
}

type ParsedDatabase =
  | { kind: "local"; url: URL }
  | { kind: "remote-postgres"; url: URL }
  | { kind: "supabase"; url: URL; projectRef: string };

function parseDatabaseUrl(value: string, label: string): ParsedDatabase {
  const url = parsePostgresUrl(value, label);
  if (isLocalHost(url.hostname)) return { kind: "local", url };
  const projectRef = projectRefFromDatabaseUrl(url);
  return projectRef
    ? { kind: "supabase", url, projectRef }
    : { kind: "remote-postgres", url };
}

function parseSupabasePostgresUrl(
  value: string | undefined,
  label: string,
): { url: URL; projectRef: string } {
  const url = parsePostgresUrl(clean(value), label);
  const projectRef = projectRefFromDatabaseUrl(url);
  if (!projectRef) throw configurationError(`${label}_NOT_SUPABASE`);
  return { url, projectRef };
}

function parsePostgresUrl(value: string, label: string): URL {
  if (!value) throw configurationError(`${label}_REQUIRED`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configurationError(`${label}_INVALID_URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw configurationError(`${label}_INVALID_PROTOCOL`);
  }
  return url;
}

function configuredSupabaseProjectRef(environment: NodeJS.ProcessEnv): string | null {
  const explicit = normalizedProjectRef(environment.SUPABASE_PROJECT_REF);
  const urlValue = clean(environment.SUPABASE_URL);
  let fromUrl: string | null = null;
  if (urlValue) {
    try {
      const url = new URL(urlValue);
      const match = /^([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
      fromUrl = match ? normalizedProjectRef(match[1]) : null;
    } catch {
      throw configurationError("SUPABASE_URL_INVALID");
    }
    if (!fromUrl) throw configurationError("SUPABASE_URL_PROJECT_REF_INVALID");
  }
  if (explicit && fromUrl && explicit !== fromUrl) {
    throw configurationError("SUPABASE_ENV_PROJECT_REF_MISMATCH");
  }
  return explicit ?? fromUrl;
}

function projectRefFromDatabaseUrl(url: URL): string | null {
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
  if (direct) return normalizedProjectRef(direct[1]);
  if (!/\.pooler\.supabase\.com$/i.test(url.hostname)) return null;
  const username = decodeURIComponent(url.username);
  const pooled = /^postgres\.([a-z0-9]{20})$/i.exec(username);
  return pooled ? normalizedProjectRef(pooled[1]) : null;
}

function normalizedProjectRef(value: string | undefined): string | null {
  const normalized = clean(value).toLowerCase();
  return /^[a-z0-9]{20}$/.test(normalized) ? normalized : null;
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function clean(value: string | undefined): string {
  return String(value ?? "").trim();
}

function positiveBoundedInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
  errorCode: string,
): number {
  const normalized = clean(value);
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw configurationError(errorCode);
  }
  return parsed;
}

function configurationError(code: string): PressureProductionConfigurationErrorV1 {
  return new PressureProductionConfigurationErrorV1(code);
}
