import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = String(process.argv[2] || "").trim().toLowerCase();
const structureOnly = process.argv.includes("--structure-only");
const checkOnly = process.argv.includes("--check");
if (!new Set(["test", "prd"]).has(target)) {
  console.error("Usage: node scripts/deploy/prepare-env-files.mjs <test|prd> [--structure-only]");
  process.exit(2);
}

const root = process.cwd();
const sourcePath = resolve(root, `.env.${target}`);
const source = await readFile(sourcePath, "utf8");
const parsed = parseDotEnv(source);

const required = [
  "MANY_WORLDS_API_ORIGIN",
  "NODE_ENV",
  "DATABASE_URL",
  "MVP_STORY_STORAGE",
  "PUBLIC_WEB_URL",
  "PAYMENT_RETURN_ORIGIN",
  "REFERRAL_BASE_URL",
  "CORS_ALLOWED_ORIGINS",
  "AUTH_TOKEN_SECRET",
  "AUTH_COOKIE_SECURE",
  "GOOGLE_AUTH_ENABLED",
  "EMAIL_PROVIDER",
  "EMAIL_REPLY_TO",
  "CREEM_MODE",
  "CREEM_MOCK_MODE",
  "CREEM_API_KEY",
  "CREEM_WEBHOOK_SECRET",
  "CREEM_PRODUCT_300_ID",
  "CREEM_PRODUCT_650_ID",
  "DEEPSEEK_API_KEY",
  "STORY_WORKER_EMBEDDED"
];

const errors = [];
for (const key of required) {
  if (!parsed.has(key)) errors.push(`${key} is missing`);
  else if (!structureOnly && isUnfilled(parsed.get(key))) errors.push(`${key} is empty or still a placeholder`);
}

if (parsed.get("GOOGLE_AUTH_ENABLED") === "true") {
  for (const key of ["GOOGLE_WEB_CLIENT_ID", "PUBLIC_GOOGLE_WEB_CLIENT_ID"]) {
    if (!parsed.has(key) || (!structureOnly && isUnfilled(parsed.get(key)))) errors.push(`${key} is required when Google auth is enabled`);
  }
}

if (parsed.get("EMAIL_PROVIDER") === "resend") {
  for (const key of ["RESEND_API_KEY", "EMAIL_FROM"]) {
    if (!parsed.has(key) || (!structureOnly && isUnfilled(parsed.get(key)))) errors.push(`${key} is required when Resend is enabled`);
  }
}

if (target === "test") {
  if (!new Set(["development", "test"]).has(parsed.get("NODE_ENV"))) errors.push("TEST NODE_ENV must be development or test");
  if (parsed.get("CREEM_MODE") !== "test") errors.push("TEST CREEM_MODE must be test");
  if (parsed.get("ALLOW_TEST_CREDIT_GRANT") !== "true") errors.push("TEST ALLOW_TEST_CREDIT_GRANT must be true");
}

if (target === "prd") {
  if (parsed.get("NODE_ENV") !== "production") errors.push("PRODUCTION NODE_ENV must be production");
  if (parsed.get("CREEM_MODE") !== "live") errors.push("PRODUCTION CREEM_MODE must be live");
  if (parsed.get("CREEM_MOCK_MODE") !== "false") errors.push("PRODUCTION CREEM_MOCK_MODE must be false");
  if (parsed.has("ALLOW_TEST_CREDIT_GRANT")) errors.push("PRODUCTION must not contain ALLOW_TEST_CREDIT_GRANT");
  if (parsed.get("AUTH_COOKIE_SECURE") !== "true") errors.push("PRODUCTION AUTH_COOKIE_SECURE must be true");
  if (parsed.get("EMAIL_PROVIDER") !== "resend") errors.push("PRODUCTION EMAIL_PROVIDER must be resend");
  if (parsed.get("MVP_STORY_STORAGE") !== "prisma") errors.push("PRODUCTION MVP_STORY_STORAGE must be prisma");
  if (!structureOnly && isUnfilled(parsed.get("ADMIN_EMAILS"))) errors.push("PRODUCTION ADMIN_EMAILS must be configured");
  for (const key of parsed.keys()) {
    if (key.startsWith("FAIL_") || key === "STORY_TASK_TEST_DELAY_MS") errors.push(`PRODUCTION must not contain ${key}`);
  }
}

if (errors.length) {
  console.error(JSON.stringify({ status: "FAIL", target, source: sourcePath, errors }, null, 2));
  process.exit(1);
}

if (structureOnly) {
  console.log(JSON.stringify({ status: "PASS", target, source: sourcePath, keys: parsed.size, mode: "structure-only" }, null, 2));
  process.exit(0);
}

if (checkOnly) {
  console.log(JSON.stringify({ status: "PASS", target, source: sourcePath, keys: parsed.size, mode: "check-only" }, null, 2));
  process.exit(0);
}

const vercelKeys = ["MANY_WORLDS_API_ORIGIN", "PUBLIC_GOOGLE_WEB_CLIENT_ID"];
const notRailway = new Set([
  ...vercelKeys,
  "MINIPROGRAM_API_BASE_URL",
  "PUBLIC_API_URL",
  "RESTORE_DATABASE_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_PITR_ENABLED"
]);
const railwayEntries = [...parsed.entries()].filter(([key]) => !notRailway.has(key));
const vercelEntries = vercelKeys.map((key) => [key, parsed.get(key)]);
const outputDir = resolve(root, "deploy/env/generated");
await mkdir(outputDir, { recursive: true });
const railwayPath = resolve(outputDir, `${target}.railway.local`);
const vercelPath = resolve(outputDir, `${target}.vercel.local`);
await writeFile(railwayPath, serialize(railwayEntries), "utf8");
await writeFile(vercelPath, serialize(vercelEntries), "utf8");
console.log(JSON.stringify({
  status: "PASS",
  target,
  source: sourcePath,
  outputs: {
    railway: { path: railwayPath, keys: railwayEntries.length },
    vercel: { path: vercelPath, keys: vercelEntries.length }
  }
}, null, 2));

function parseDotEnv(text) {
  const values = new Map();
  for (const [index, rawLine] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Invalid env syntax at line ${index + 1}`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (values.has(match[1])) throw new Error(`Duplicate env key ${match[1]} at line ${index + 1}`);
    values.set(match[1], value);
  }
  return values;
}

function isUnfilled(value) {
  return !String(value || "").trim() || /^<FILL_[A-Z0-9_]+>$/.test(String(value).trim());
}

function serialize(entries) {
  return `${entries.map(([key, value]) => `${key}=${quoteIfNeeded(value)}`).join("\n")}\n`;
}

function quoteIfNeeded(value) {
  const text = String(value ?? "");
  if (!/[\s#'"\\]/.test(text)) return text;
  return JSON.stringify(text);
}
