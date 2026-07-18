import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const sourcePath = resolve(root, ".env");
const testPath = resolve(root, ".env.test");
const productionPath = resolve(root, ".env.prd");
const sourceText = await readFile(sourcePath, "utf8");
const source = parseDotEnv(sourceText);

if (source.values.get("NODE_ENV") === "production" || source.values.get("CREEM_MODE") === "live") {
  throw new Error("Refusing to import: current .env does not look like a TEST environment");
}

const testText = await readFile(testPath, "utf8");
const test = parseDotEnv(testText);
const testOverrides = new Map();
for (const [key, rawValue] of source.rawValues) {
  if (test.values.has(key) && source.values.get(key) !== "") testOverrides.set(key, rawValue);
}
const currentDatabaseUrl = source.values.get("DATABASE_URL");
const currentSupabaseDatabaseUrl = source.values.get("SUPABASE_DATABASE_URL");
if (currentSupabaseDatabaseUrl && isLocalDatabaseUrl(currentDatabaseUrl)) {
  const supabaseRawValue = source.rawValues.get("SUPABASE_DATABASE_URL");
  testOverrides.set("DATABASE_URL", supabaseRawValue);
  testOverrides.set("SUPABASE_DATABASE_URL", supabaseRawValue);
}
if (isUnfilled(test.values.get("AUTH_TOKEN_SECRET"))) testOverrides.set("AUTH_TOKEN_SECRET", randomBytes(64).toString("base64"));
if (!source.values.get("GOOGLE_WEB_CLIENT_ID")) {
  testOverrides.set("GOOGLE_AUTH_ENABLED", "false");
  testOverrides.set("GOOGLE_WEB_CLIENT_ID", "");
  testOverrides.set("PUBLIC_GOOGLE_WEB_CLIENT_ID", "");
}
if (!source.values.get("RESEND_API_KEY")) {
  testOverrides.set("EMAIL_PROVIDER", "file-sink");
  testOverrides.set("RESEND_API_KEY", "");
  testOverrides.set("EMAIL_FROM", "");
}
if (!source.values.get("EMAIL_REPLY_TO")) testOverrides.set("EMAIL_REPLY_TO", "support@ourmanyworlds.com");
if (!source.values.get("ADMIN_EMAILS")) testOverrides.set("ADMIN_EMAILS", "");
await writeFile(testPath, applyOverrides(testText, testOverrides), "utf8");

const productionText = await readFile(productionPath, "utf8");
const production = parseDotEnv(productionText);
const safeProductionKeys = new Set([
  "API_PORT",
  "MVP_STORY_STORAGE",
  "AI_PROVIDER",
  "AI_MODEL",
  "AI_DIRECTOR_PROVIDER",
  "AI_CAUSAL_PROVIDER",
  "AI_CAUSAL_TIMEOUT_MS",
  "AI_CAUSAL_MAX_ATTEMPTS",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "CREEM_MOCK_MODE"
]);
const productionOverrides = new Map();
for (const key of safeProductionKeys) {
  if (source.rawValues.has(key) && source.values.get(key) !== "") productionOverrides.set(key, source.rawValues.get(key));
}
if (isUnfilled(production.values.get("AUTH_TOKEN_SECRET"))) productionOverrides.set("AUTH_TOKEN_SECRET", randomBytes(64).toString("base64"));
await writeFile(productionPath, applyOverrides(productionText, productionOverrides), "utf8");

const mergedTest = parseDotEnv(await readFile(testPath, "utf8"));
const mergedProduction = parseDotEnv(await readFile(productionPath, "utf8"));
console.log(JSON.stringify({
  status: "PASS",
  source: sourcePath,
  test: {
    path: testPath,
    copiedKeys: [...testOverrides.keys()].sort(),
    remainingPlaceholders: placeholderKeys(mergedTest.values)
  },
  production: {
    path: productionPath,
    copiedSafeKeys: [...productionOverrides.keys()].sort(),
    remainingPlaceholders: placeholderKeys(mergedProduction.values)
  },
  secretValuesPrinted: false
}, null, 2));

function parseDotEnv(text) {
  const values = new Map();
  const rawValues = new Map();
  for (const [index, rawLine] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Invalid env syntax at line ${index + 1}`);
    if (values.has(match[1])) throw new Error(`Duplicate env key ${match[1]} at line ${index + 1}`);
    const rawValue = match[2].trim();
    let value = rawValue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values.set(match[1], value);
    rawValues.set(match[1], rawValue);
  }
  return { values, rawValues };
}

function applyOverrides(text, overrides) {
  const seen = new Set();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match || !overrides.has(match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${overrides.get(match[1])}`;
  });
  const missing = [...overrides.keys()].filter((key) => !seen.has(key));
  if (missing.length) throw new Error(`Target env is missing keys: ${missing.join(", ")}`);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function isUnfilled(value) {
  return !String(value || "").trim() || /^<FILL_[A-Z0-9_]+>$/.test(String(value).trim());
}

function isLocalDatabaseUrl(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function placeholderKeys(values) {
  return [...values.entries()]
    .filter(([, value]) => /^<FILL_[A-Z0-9_]+>$/.test(String(value).trim()))
    .map(([key]) => key)
    .sort();
}
