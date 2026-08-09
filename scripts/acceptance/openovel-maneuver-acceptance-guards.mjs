const SUPABASE_HOST_SUFFIXES = [".supabase.com", ".supabase.co"];
const LOCAL_FAVICON_404_TEXT = "Failed to load resource: the server responded with a status of 404 (Not Found)";

export function isAllowedLocalFavicon404ConsoleItem(item, webOrigin) {
  if (item?.kind !== "log" || item?.type !== "error") return false;
  if (String(item.text || "").trim() !== LOCAL_FAVICON_404_TEXT) return false;

  let expectedOrigin;
  let resourceUrl;
  try {
    expectedOrigin = new URL(String(webOrigin || "")).origin;
    resourceUrl = new URL(String(item.url || ""));
  } catch {
    return false;
  }

  return resourceUrl.origin === expectedOrigin
    && resourceUrl.pathname === "/favicon.ico"
    && resourceUrl.search === ""
    && resourceUrl.hash === "";
}

export function classifyBrowserConsoleItems(items, webOrigin) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!isAllowedLocalFavicon404ConsoleItem(item, webOrigin)) return item;
    return {
      ...item,
      type: "ignored",
      originalType: item.type,
      acceptanceReason: "local-favicon-404",
    };
  });
}

export function isSupabaseDatabaseHostname(value) {
  const hostname = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) return false;
  return hostname === "supabase.com"
    || hostname === "supabase.co"
    || SUPABASE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

export function assertSupabaseTestDatabaseUrl(value, label = "DATABASE_URL") {
  const raw = String(value || "").trim();
  if (!raw) throw new Error(`${label} is required for Supabase acceptance`);

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL Supabase URL`);
  }

  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error(`${label} must use the postgres or postgresql protocol`);
  }
  if (!isSupabaseDatabaseHostname(parsed.hostname)) {
    throw new Error(
      `${label} must target an official Supabase hostname; received ${parsed.hostname || "<missing>"}`,
    );
  }

  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname.toLowerCase(),
  };
}

export async function ensureMainDecisionSurface({
  inspect,
  clickOpeningGate,
  waitForDecision,
  label = "main story",
}) {
  if (typeof inspect !== "function") throw new TypeError("inspect must be a function");
  if (typeof clickOpeningGate !== "function") throw new TypeError("clickOpeningGate must be a function");
  if (typeof waitForDecision !== "function") throw new TypeError("waitForDecision must be a function");

  const initial = await inspect();
  assertNoFatalSurface(initial, label);
  if (isDecisionSurfaceReady(initial)) {
    return { openedFromPrologue: false, surface: initial };
  }
  if (!initial?.begin) {
    throw new Error(`${label}: neither #beginStoryBtn nor a complete main-decision surface is available`);
  }

  await clickOpeningGate();
  const ready = await waitForDecision();
  assertNoFatalSurface(ready, label);
  if (!isDecisionSurfaceReady(ready)) {
    throw new Error(`${label}: opening gate completed without decision inputs and #submitDecision`);
  }
  return { openedFromPrologue: true, surface: ready };
}

export async function submitObservedMainDecision({
  label = "main story",
  inspect,
  clickOpeningGate,
  waitForDecision,
  readWorldSequence,
  submitDecision,
  waitForWorldSequence,
}) {
  if (typeof readWorldSequence !== "function") throw new TypeError("readWorldSequence must be a function");
  if (typeof submitDecision !== "function") throw new TypeError("submitDecision must be a function");
  if (typeof waitForWorldSequence !== "function") throw new TypeError("waitForWorldSequence must be a function");

  const readiness = await ensureMainDecisionSurface({
    inspect,
    clickOpeningGate,
    waitForDecision,
    label,
  });
  const sequenceBefore = Number(await readWorldSequence());
  if (!Number.isInteger(sequenceBefore) || sequenceBefore < 0) {
    throw new Error(`${label}: invalid authoritative world sequence before submission`);
  }

  const submitted = await submitDecision();
  if (!submitted) throw new Error(`${label}: central decision was not submitted`);

  const sequenceAfter = Number(await waitForWorldSequence(sequenceBefore + 1));
  if (sequenceAfter !== sequenceBefore + 1) {
    throw new Error(`${label}: central decision did not advance worldSequence exactly once`);
  }
  return {
    ...readiness,
    sequenceBefore,
    sequenceAfter,
  };
}

export function isDecisionSurfaceReady(value) {
  return Boolean(value?.submit) && Number(value?.decisionCount || 0) > 0;
}

function assertNoFatalSurface(value, label) {
  if (value?.fatal) throw new Error(`${label}: ${value.fatal}`);
}
