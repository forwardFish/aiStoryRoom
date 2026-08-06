import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { OpenNovelRuntime } from "../src/runtime.js";
import { FileStoryWorkspace } from "../src/workspace.js";
import { sangtianDecisionAdapter } from "../src/sangtian-decisions.js";
import { sangtianWorkspaceSeeder } from "../src/sangtian-workspace.js";
import { sangtianEndingModule } from "../src/sangtian-ending.js";
import { FileAtomicTurnRepository } from "../src/atomic-turn.js";
import { auditOpenNovelRun } from "../src/audit.js";
import type {
  EventMirror,
  MirrorEvent,
  OpenNovelProvider,
  ProviderRequest,
  TurnResult,
} from "../src/types.js";

test("P07 authored G00-T20 commits one server beat and one atomic Head per turn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-authored-five-turn-"));
  const projectRoot = path.basename(process.cwd()) === "openovel-runtime"
    ? path.resolve(process.cwd(), "..", "..")
    : path.resolve(import.meta.dirname, "..", "..", "..");
  const runId = "authored_atomic_t05";
  const workspace = new FileStoryWorkspace(root, projectRoot, "test-upstream", sangtianWorkspaceSeeder);
  const provider = new UnavailableNarrator();
  const runtime = new OpenNovelRuntime(
    workspace,
    provider,
    { kick: async () => {} },
    new NoopMirror(),
    {
      decisionMode: "AUTHORED_WHEN_AVAILABLE",
      authoredDecisionAdapter: sangtianDecisionAdapter,
      endingModule: sangtianEndingModule,
    },
  );
  try {
    const opening = await runtime.createRun({
      runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });
    assert.match(opening.prologueNarrative, /天下仍披着太平的外衣/u);
    assert.match(opening.recentCanon, /杭州总督府内厅/u);
    assert.match(opening.recentCanon, /巡抚书吏/u);
    assert.match(opening.recentCanon, /县令亲随/u);
    let options = (await workspace.snapshot(runId)).previousOptions;
    const preferredOpening = options.find((option) => option.id === "opening_d1");
    assert.ok(preferredOpening);
    let selected = preferredOpening;
    let finalSubmissionId = "";
    let finalAction = "";
    let finalBoundOption: { id: string; label: string } | null = null;
    let finalTurnResult: TurnResult | null = null;

    for (let turn = 1; turn <= 20; turn += 1) {
      const submissionId = `authored_t${String(turn).padStart(2, "0")}_submission`;
      const freeTextAction = turn === 1
        ? "暂不签发，先让两边把各自知道的事说清。"
        : "";
      const submittedAction = freeTextAction || selected.label;
      const submittedBoundOption = freeTextAction
        ? null
        : { id: selected.id, label: selected.label };
      if (turn === 20) {
        finalSubmissionId = submissionId;
        finalAction = submittedAction;
        finalBoundOption = submittedBoundOption;
      }
      const result = await runtime.processAction({
        runId,
        action: submittedAction,
        submissionId,
        boundOption: submittedBoundOption,
      });
      if (turn === 20) finalTurnResult = result;
      assert.equal(result.turnNumber, turn);
      assert.ok(result.narration.trim().length > 0);
      assert.ok(result.causalDelta.beatContract?.narrativeSeed);
      assert.ok(result.causalDelta.beatContract?.sceneEvidence?.evidenceItems.length);
      if (turn === 1) {
        const firstEvent = JSON.parse((await readFile(
          workspace.paths(runId).partOneEvents,
          "utf8",
        )).trim().split(/\r?\n/u).at(-1)!);
        assert.ok(String(firstEvent.decisionKernelId || "").trim());
        assert.equal(firstEvent.affordanceTemplateId, null);
        assert.equal(result.causalDelta.readerAction, freeTextAction);
      }
      if (turn === 2) {
        assert.doesNotMatch(result.narration, /只写|不得写|内部状态|验收关键词/u);
        assert.doesNotMatch(result.narration, /随即交由.*持有/u);
        const turnTwoState = JSON.parse(await readFile(
          workspace.paths(runId).partOneState,
          "utf8",
        ));
        const reply = turnTwoState.scene.documentStates.find(
          (document: { documentRef: string }) => (
            document.documentRef === "document.reform_execution_record"
          ),
        );
        const box = turnTwoState.scene.objectStates.find(
          (object: { objectRef: string }) => object.objectRef === "object.xunfu_reply_box",
        );
        assert.equal(reply?.accessState, "WRITTEN");
        assert.equal(reply?.holderRef, "actor.xunfu_clerk");
        assert.equal(box?.contentsState, "CONTAINS_DOCUMENT");
        assert.equal(box?.closureState, "CLOSED");
      }
      const repository = new FileAtomicTurnRepository(workspace.paths(runId));
      const head = await repository.loadHead();
      assert.equal(head?.turnNumber, turn);
      assert.equal(head?.turnId, `T${String(turn).padStart(2, "0")}`);
      assert.ok(head);
      const beatManifest = await repository.readArtifactJson<{
        dramaticGuidance?: { sourceMechanisms?: string[] };
        tickets?: Array<{
          slot: string;
          expressionOwner?: string;
          protectedText?: string;
          requiredMeaning: string;
        }>;
      }>(head, "beat-manifest.json");
      assert.ok(
        beatManifest.dramaticGuidance?.sourceMechanisms?.length,
        `T${String(turn).padStart(2, "0")} must carry source-grounded dramatic material`,
      );
      if (turn === 20) {
        const terminalStop = beatManifest.tickets?.find((ticket) => (
          ticket.slot === "DECISION_STOP"
        ));
        assert.equal(terminalStop?.expressionOwner, "PROTECTED");
        assert.equal(terminalStop?.protectedText, terminalStop?.requiredMeaning);
      }
      const atomicOptions = await repository.readArtifactJson<Array<{ id: string }>>(
        head,
        "options.json",
      );
      if (result.storyComplete) {
        assert.equal(turn, 20);
        assert.deepEqual(atomicOptions, []);
      } else {
        assert.ok(atomicOptions.length >= 2);
      }
      assert.deepEqual(
        atomicOptions.map((option) => option.id),
        result.options.map((option) => option.id),
      );
      if (turn === 1) {
        await assert.rejects(() => runtime.processAction({
          runId,
          action: selected.label,
          submissionId: "stale-revision-submission",
          expectedStateRevision: 0,
          boundOption: { id: selected.id, label: selected.label },
        }), /STATE_REVISION_CONFLICT/);
        assert.equal((await workspace.metadata(runId)).status, "READY");
        await assert.rejects(() => runtime.processAction({
          runId,
          action: "A different action must not reuse the committed key.",
          submissionId: "authored_t01_submission",
        }), /IDEMPOTENCY_KEY_REUSED/);
        assert.equal((await workspace.metadata(runId)).status, "READY");
        assert.equal((await repository.loadHead())?.turnNumber, 1);
      }
      options = (await workspace.snapshot(runId)).previousOptions;
      if (result.storyComplete) {
        assert.equal(turn, 20);
        assert.deepEqual(options, []);
      } else {
        assert.ok(options.length >= 2);
        assert.ok(options.every((option) => option.effect?.decisionPointId));
        selected = options[0];
      }
    }

    const paths = workspace.paths(runId);
    const state = JSON.parse(await readFile(paths.partOneState, "utf8"));
    const canon = await readFile(paths.chapters, "utf8");
    const events = (await readFile(paths.partOneEvents, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean);
    assert.equal(state.turnNumber, 20);
    assert.equal(state.partCompletionStatus, "HANDOFF_READY");
    const publicRun = await workspace.readPublicRun(runId);
    assert.ok(finalTurnResult);
    assert.equal(publicRun.status, "COMPLETED");
    assert.equal(finalTurnResult.storyComplete, true);
    assert.deepEqual(finalTurnResult.ending, publicRun.ending);
    assert.equal(publicRun.ending?.sourceTurnId, "T20");
    assert.ok(publicRun.ending?.finalSceneNarrative.trim());
    assert.ok(publicRun.ending?.protagonistFate.trim());
    assert.ok(publicRun.ending?.aftermath.length);
    assert.deepEqual(publicRun.options, []);
    for (const privateField of [
      "causalDelta",
      "worldState",
      "durableTurnEnvelope",
      "allowedPredicates",
      "narrativeSeed",
      "truthReview",
      "reviewerConfidence",
    ]) {
      assert.equal(Object.hasOwn(publicRun, privateField), false);
    }
    assert.equal(events.length, 20);
    assert.equal((canon.match(/\*\*读者选择\*\*/gu) || []).length, 20);
    assert.equal((await readdir(paths.headsDir)).length, 20);
    assert.equal(provider.narratorAttempts, 20);
    const audit = await auditOpenNovelRun(paths, { targetTurns: 20 });
    assert.equal(audit.technical.checks.narrativeOwnerRecordedForEveryCommittedTurn, true);
    assert.equal(audit.technical.checks.optionsRecordedForEveryCommittedTurn, true);
    assert.equal(audit.technical.optionRecords, 20);
    assert.equal(audit.model.profiles.options.calls, 0);
    await assert.rejects(
      () => runtime.processAction({ runId, action: "继续下令。" }),
      /RUN_COMPLETED/u,
    );
    await assert.rejects(() => runtime.recoverOptions(runId), /RUN_COMPLETED/u);
    assert.equal((await workspace.readPublicRun(runId)).status, "COMPLETED");

    const restartedProvider = new UnavailableNarrator();
    const restartedWorkspace = new FileStoryWorkspace(
      root,
      projectRoot,
      "test-upstream",
      sangtianWorkspaceSeeder,
    );
    const restartedRuntime = new OpenNovelRuntime(
      restartedWorkspace,
      restartedProvider,
      { kick: async () => {} },
      new NoopMirror(),
      {
        decisionMode: "AUTHORED_WHEN_AVAILABLE",
        authoredDecisionAdapter: sangtianDecisionAdapter,
        endingModule: sangtianEndingModule,
      },
    );
    const afterRestart = await restartedRuntime.getRun(runId);
    assert.deepEqual(afterRestart.ending, publicRun.ending);
    assert.deepEqual(afterRestart.options, []);
    const replayedFinalTurn = await restartedRuntime.processAction({
      runId,
      action: finalAction,
      submissionId: finalSubmissionId,
      boundOption: finalBoundOption,
    });
    assert.deepEqual(replayedFinalTurn.ending, publicRun.ending);
    assert.equal(restartedProvider.narratorAttempts, 0);
    assert.equal((await readdir(paths.headsDir)).length, 20);
    assert.equal((await restartedWorkspace.readPublicRun(runId)).status, "COMPLETED");
    await assert.rejects(() => restartedRuntime.processAction({
      runId,
      action: "相同幂等键不得改写成另一项行动。",
      submissionId: finalSubmissionId,
    }), /IDEMPOTENCY_KEY_REUSED/u);
    await assert.rejects(() => restartedRuntime.processAction({
      runId,
      action: finalAction,
      submissionId: "a-new-submission-after-ending",
      boundOption: finalBoundOption,
    }), /RUN_COMPLETED/u);
    assert.equal(restartedProvider.narratorAttempts, 0);
    assert.equal((await readdir(paths.headsDir)).length, 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class UnavailableNarrator implements OpenNovelProvider {
  narratorAttempts = 0;

  async generate(request: ProviderRequest): Promise<never> {
    if (request.profile === "narrator") this.narratorAttempts += 1;
    throw new Error("TEST_PROVIDER_UNAVAILABLE");
  }

  describe() {
    return { provider: "test", model: "unavailable", configured: true };
  }
}

class NoopMirror implements EventMirror {
  async publish(_event: MirrorEvent) {}
}
