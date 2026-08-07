import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  SupabaseAcceptanceError,
  inspectSupabaseAcceptanceEnvironment,
  prepareSupabaseAcceptanceEnvironment,
  verifySupabaseAcceptanceConnection,
} from "./supabase-formal-acceptance.mjs";

const noConnect = process.argv.includes("--no-connect");
const evidencePath = resolve(
  process.env.SUPABASE_ACCEPTANCE_EVIDENCE_PATH
    || "outputs/dynamic-kernel-lite-supabase/supabase-preflight.json",
);

try {
  prepareSupabaseAcceptanceEnvironment(process.env);
  const contract = inspectSupabaseAcceptanceEnvironment(process.env, {
    requireFormal: true,
  });
  const result = noConnect
    ? { ...contract, connected: false, verifiedAt: new Date().toISOString() }
    : await verifySupabaseAcceptanceConnection(contract);
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(
    evidencePath,
    `${JSON.stringify({
      schemaVersion: "omw.supabase-formal-acceptance.v1",
      status: "PASS",
      ...result,
    }, null, 2)}\n`,
    "utf8",
  );
  console.log("SUPABASE_FORMAL_ACCEPTANCE_PREFLIGHT_PASS");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const blocked = error instanceof SupabaseAcceptanceError;
  const result = {
    schemaVersion: "omw.supabase-formal-acceptance.v1",
    status: blocked ? "BLOCKED" : "FAIL",
    code: error?.code || "SUPABASE_ACCEPTANCE_PREFLIGHT_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error?.details || {},
    checkedAt: new Date().toISOString(),
  };
  await mkdir(dirname(evidencePath), { recursive: true }).catch(() => {});
  await writeFile(
    evidencePath,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  ).catch(() => {});
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = blocked ? 78 : 1;
}
