import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  hashIdentifier,
  pnpmInvocation,
  requireNonProductionSupabaseUrl,
  resolvePnpmTransport
} from "../e2e/a-emotion-m6-e2e-contract.mts";

const baseUrl = required("A_EMOTION_M6_SUPABASE_URL");
const parsed = requireNonProductionSupabaseUrl(baseUrl, process.env.A_EMOTION_M6_NONPROD_CONFIRM);
const schema = `aemotion_m6_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const scoped = new URL(parsed); scoped.searchParams.set("schema", schema);
const transport = resolvePnpmTransport();
const { PrismaClient } = await import("@prisma/client");
const admin = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
let created = false;
try {
  await admin.$connect();
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
  await command(["exec", "prisma", "db", "push", "--skip-generate"], { DATABASE_URL: scoped.toString() });
  const testEnv = {
    DATABASE_URL: scoped.toString(),
    A_EMOTION_M1_TEST_DATABASE_URL: scoped.toString(),
    A_EMOTION_M2_TEST_DATABASE_URL: scoped.toString(),
    A_EMOTION_M3_TEST_DATABASE_URL: scoped.toString(),
    A_EMOTION_M4_TEST_DATABASE_URL: scoped.toString(),
    A_EMOTION_M5_TEST_DATABASE_URL: scoped.toString(),
    A_EMOTION_M6_TEST_DATABASE_URL: scoped.toString()
  };
  for (const stage of [1, 2, 3, 4, 5, 6]) await command([`test:a-emotion-m${stage}`], testEnv);
  const tables = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM information_schema.tables WHERE table_schema = '${schema}'`);
  assert.ok(Number(tables[0]?.count || 0) > 0, "random schema must contain persisted tables before cleanup");
  console.log(JSON.stringify({ schemaFingerprint: fingerprint(schema), readback: "PASS", tables: Number(tables[0]?.count || 0) }));
} finally {
  if (created) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  const absent = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM information_schema.schemata WHERE schema_name = '${schema}'`);
  assert.equal(Number(absent[0]?.count || 0), 0, "random schema must be absent after finally cleanup");
  console.log(JSON.stringify({ schemaFingerprint: fingerprint(schema), cleanup: "PASS", schemaAbsent: true }));
  await admin.$disconnect();
}

function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function command(args: string[], extra: NodeJS.ProcessEnv) {
  const invocation = pnpmInvocation(transport, args);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.program, invocation.args, { stdio: "inherit", env: { ...process.env, ...extra }, shell: false });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`pnpm acceptance command exited ${code}`)));
  });
}
function fingerprint(value: string) { return hashIdentifier(value, 16); }
