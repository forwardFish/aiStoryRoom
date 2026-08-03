import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NoopMirror } from "../src/mirror.js";
import { OpenNovelRuntime } from "../src/runtime.js";
import { sangtianDecisionAdapter } from "../src/sangtian-decisions.js";
import {
  buildStoryFactReviewUnits,
  buildTruthReviewUnits,
} from "../src/truth-review.js";
import type {
  OpenNovelProvider,
  ProviderRequest,
  ProviderResult,
} from "../src/types.js";
import { FileStoryWorkspace } from "../src/workspace.js";
import { sangtianWorkspaceSeeder } from "../src/sangtian-workspace.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..", "..");
const upstreamCommit = "1b4404e85d03d1e41e5d745e303372333b29c610";

test("P04 rejects an extra player order and an incomplete repair, then publishes the reviewed fallback", async () => {
  const draft = "总督又命人跟牌同去。巡抚书吏抬眼等候。";
  const conflictQuote = "总督又命人跟牌同去";
  const provider = new QueueProvider([
    result(draft, "narrator-model"),
    result(reviewJson(draft, [{
      predicate: {
        type: "ACTOR.ORDERED",
        actorId: "actor.zhejiang_governor",
        capabilityId: "runtime.capability.unspecified_order",
      },
      ...span(draft, conflictQuote),
      explicitness: "EXPLICIT",
      confidence: 0.99,
    }]), "reviewer-model"),
    result(JSON.stringify({
      edits: [{ exactQuote: conflictQuote, replacement: "" }],
      appendText: "",
    }), "repair-model"),
    result(reviewJson("巡抚书吏抬眼等候。", []), "reviewer-model"),
  ]);
  await withRuntime(provider, async ({ runtime, workspace, runId }) => {
    const opening = await workspace.snapshot(runId);
    const selected = opening.previousOptions.find((option) => option.id === "opening_d2");
    assert.ok(selected);
    const resultValue = await runtime.processAction({
      runId,
      action: selected.label,
      boundOption: { id: selected.id, label: selected.label },
    });
    assert.equal(resultValue.turnNumber, 1);
    assert.doesNotMatch(resultValue.narration, /跟牌同去/);
    assert.match(resultValue.narration, /封缄令牌/);
    assert.ok(resultValue.causalDelta.beatContract?.settledNarrative);
    assert.equal(
      resultValue.narration.startsWith(resultValue.causalDelta.beatContract.settledNarrative),
      true,
    );
    assert.doesNotMatch(resultValue.narration, /巡抚书吏抬眼等候/);
    assert.match(resultValue.narration, /巡抚书吏仍候在厅中.*边界执行/su);
    assert.deepEqual(provider.profiles, [
      "narrator",
      "reviewer",
      "repair",
      "reviewer",
    ]);
    const events = await readFile(workspace.paths(runId).sceneLog, "utf8");
    assert.match(events, /USE_FALLBACK/);
    const calls = await readdir(workspace.paths(runId).callsDir);
    assert.equal(calls.filter((name) => /\.narrator(?:\.|$)/.test(name)).length, 1);
    assert.equal(calls.filter((name) => /\.reviewer(?:\.|$)/.test(name)).length, 2);
    assert.equal(calls.filter((name) => /\.repair(?:\.|$)/.test(name)).length, 1);
  });
});

test("P04 narrator failure uses deterministic fallback and still commits", async () => {
  const provider = new QueueProvider([new Error("narrator unavailable")]);
  await withRuntime(provider, async ({ runtime, workspace, runId }) => {
    const opening = await workspace.snapshot(runId);
    const selected = opening.previousOptions.find((option) => option.id === "opening_d2");
    assert.ok(selected);
    const resultValue = await runtime.processAction({
      runId,
      action: selected.label,
      boundOption: { id: selected.id, label: selected.label },
    });
    assert.equal(resultValue.turnNumber, 1);
    assert.ok(resultValue.narration.length > 20);
    assert.match(resultValue.narration, /封缄令牌/);
    assert.ok(resultValue.causalDelta.beatContract?.settledNarrative);
    assert.equal(
      resultValue.narration.startsWith(resultValue.causalDelta.beatContract.settledNarrative),
      true,
    );
    assert.match(resultValue.narration, /巡抚书吏仍候在厅中.*边界执行/su);
    assert.deepEqual(provider.profiles, ["narrator"]);
    const events = await readFile(workspace.paths(runId).sceneLog, "utf8");
    assert.match(events, /USE_FALLBACK/);
    const publicRun = await runtime.getRun(runId);
    assert.equal(publicRun.turnNumber, 1);
    assert.notEqual(publicRun.status, "FAILED");
  });
});

test("P04 deterministic fallback never invents a responsibility-record handoff", async () => {
  const provider = new QueueProvider([
    new Error("T01 narrator unavailable"),
    new Error("T02 narrator unavailable"),
    new Error("T03 narrator unavailable"),
  ]);
  await withRuntime(provider, async ({ runtime, workspace, runId }) => {
    const opening = await workspace.snapshot(runId);
    const inquiry = opening.previousOptions.find((option) => option.id === "opening_d1");
    assert.ok(inquiry);
    const first = await runtime.processAction({
      runId,
      action: inquiry.label,
      boundOption: { id: inquiry.id, label: inquiry.label },
    });
    const limitedTrial = first.options.find(
      (option) => option.id === "DK-P1-EXECUTION-SCOPE-OPT-01",
    );
    assert.ok(limitedTrial);
    const second = await runtime.processAction({
      runId,
      action: limitedTrial.label,
      boundOption: { id: limitedTrial.id, label: limitedTrial.label },
    });
    const separateResponsibility = second.options.find(
      (option) => option.id === "DK-P1-RESPONSIBILITY-RECORD-OPT-03",
    );
    assert.ok(separateResponsibility);
    const prepared = await sangtianDecisionAdapter.prepare(workspace, {
      runId,
      turnNumber: 3,
      action: separateResponsibility.label,
      selectedOption: separateResponsibility,
    });
    assert.ok(prepared);
    assert.match(
      prepared.settledNarrative,
      /议事转至嘉靖三十五年五月初九巳时，杭州总督府签押房/u,
    );
    assert.match(
      prepared.settledNarrative,
      /清流县令、改桑书吏和巡抚幕僚已经到场/u,
    );
    assert.deepEqual(
      prepared.truthContext.requiredVisiblePredicates.map((item) => item.pattern),
      [{
        type: "ACTOR.ORDERED",
        constraints: {
          actorId: "actor.xunfu_aide",
          capabilityId: "PAYOFF-P1-XUNFU-COUNTERMOVE-D4E74450",
        },
      }],
    );
    const third = await runtime.processAction({
      runId,
      action: separateResponsibility.label,
      boundOption: {
        id: separateResponsibility.id,
        label: separateResponsibility.label,
      },
    });

    assert.match(third.narration, /督抚责任说明.*浙江总督持有/su);
    assert.match(third.narration, /签押房.*巡抚幕僚/su);
    assert.doesNotMatch(
      third.narration,
      /巡抚书吏(?:接过|收下|持有|带走).*?(?:责任说明|逐项记明异议的回文)/su,
    );
    const state = JSON.parse(await readFile(workspace.paths(runId).partOneState, "utf8"));
    const responsibilityRecord = state.scene.documentStates.find(
      (document: { documentRef: string }) => (
        document.documentRef === "document.responsibility_record"
      ),
    );
    assert.equal(responsibilityRecord?.holderRef, "actor.zhejiang_governor");
    assert.deepEqual(provider.profiles, ["narrator", "narrator", "narrator"]);
  });
});

async function withRuntime(
  provider: QueueProvider,
  run: (input: {
    runtime: OpenNovelRuntime;
    workspace: FileStoryWorkspace;
    runId: string;
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-p04-runtime-"));
  const runId = `p04_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const workspace = new FileStoryWorkspace(root, projectRoot, upstreamCommit, sangtianWorkspaceSeeder);
  const runtime = new OpenNovelRuntime(
    workspace,
    provider,
    { kick: async () => {} },
    new NoopMirror(),
    {
      decisionMode: "AUTHORED_WHEN_AVAILABLE",
      authoredDecisionAdapter: sangtianDecisionAdapter,
    },
  );
  try {
    await runtime.createRun({
      runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });
    await run({ runtime, workspace, runId });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

class QueueProvider implements OpenNovelProvider {
  readonly profiles: ProviderRequest["profile"][] = [];
  constructor(private readonly queue: Array<ProviderResult | Error>) {}
  describe() {
    return { provider: "fixture", model: "fixture", configured: true };
  }
  async generate(request: ProviderRequest) {
    this.profiles.push(request.profile);
    const next = this.queue.shift();
    if (!next) throw new Error(`fixture queue exhausted at ${request.profile}`);
    if (next instanceof Error) throw next;
    return next;
  }
}

function result(text: string, model: string): ProviderResult {
  return {
    text,
    model,
    usage: { inputTokens: 1, outputTokens: 1 },
    latencyMs: 1,
  };
}

function reviewJson(draft: string, assertions: unknown[]) {
  const actionQuotes = assertions.flatMap((value) => {
    const item = value as Record<string, unknown>;
    const predicate = item.predicate as Record<string, unknown> | undefined;
    return (
      (predicate?.type === "ACTOR.ORDERED" || predicate?.type === "ACTOR.COMMITTED")
      && predicate.actorId === "actor.zhejiang_governor"
    ) ? [String(item.exactQuote)] : [];
  });
  return JSON.stringify({
    assertions,
    originActionAssessments: buildTruthReviewUnits(draft).map((unit) => {
      const quotes = actionQuotes.filter((quote) => unit.text.includes(quote));
      return quotes.length
        ? {
            unitId: unit.unitId,
            classification: "UNAUTHORIZED",
            exactQuotes: quotes,
            confidence: 0.99,
          }
        : {
            unitId: unit.unitId,
            classification: "NO_DURABLE_ACTION",
            exactQuotes: [],
            confidence: 0.99,
          };
    }),
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [],
    storyFactAssessments: buildStoryFactReviewUnits(draft).map((unit) => ({
      unitId: unit.unitId,
      classification: "TEXTURE_OR_TRANSIENT",
      supportIds: [],
      confidence: 0.99,
    })),
  });
}

function span(draft: string, exactQuote: string) {
  const quoteStart = draft.indexOf(exactQuote);
  assert.notEqual(quoteStart, -1);
  return {
    exactQuote,
    quoteStart,
    quoteEnd: quoteStart + exactQuote.length,
  };
}
