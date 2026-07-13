import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DeepSeekMvpNarrativeProvider } from "../../apps/api/src/mvp-narrative-provider";

const candidate = {
  immediateResult: { resultMessage: { title: "重试成功", narrative: "仅返回可见叙事。" } },
  visibleCausalCard: { decisionSummary: "已按规则落账", personalEcho: "保留证据", worldEcho: "局势变化", playerFacingHint: "后续会产生回响" },
  roleReactions: []
};

async function main() {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) throw new Error("injected timeout");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const provider = new DeepSeekMvpNarrativeProvider({ apiKey: "test", baseUrl: "http://retry.test", timeoutMs: 1000, maxAttempts: 2 });
  const output = await provider.generateDecisionCandidate({ test: true });
  assert.deepEqual(output, candidate);
  assert.equal(calls, 2);
  assert.equal(provider.lastCall.attempts, 2);
  globalThis.fetch = originalFetch;
  const result = { schemaVersion: "provider-retry-contract-v1", status: "PASS", calls, attempts: provider.lastCall.attempts, maxAttempts: provider.lastCall.maxAttempts };
  await mkdir(join(process.cwd(), "docs/auto-execute/results"), { recursive: true });
  await writeFile(join(process.cwd(), "docs/auto-execute/results/provider-retry-contract.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { globalThis.fetch = globalThis.fetch; console.error(error); process.exitCode = 1; });
