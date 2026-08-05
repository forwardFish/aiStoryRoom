import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildPartOneTurnProgressReport,
  buildPartOneRuntimeWorkingSet,
  createInitialPartOneState,
  finalizePartOneSettlement,
  settlePartOneAction
} from "../../../packages/templates/src/story-package/part-one-runtime-engine";

test("Part One authoring compilation keeps evidence chain states inside the approved contract", async () => {
  const root = resolve(".");
  const tempRoot = await mkdtemp(join(tmpdir(), "sangtian-part-one-compile-"));
  const runtimePath = join(tempRoot, "part-one-runtime.json");
  try {
    const compilation = spawnSync(process.execPath, ["scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        SANGTIAN_AUTHORING_OUTPUT_ROOT: join(tempRoot, "runtime-assets"),
        SANGTIAN_RUNTIME_PACKAGE_PATH: runtimePath,
        SANGTIAN_SKIP_SOURCE_WRITES: "1"
      }
    });
    assert.equal(compilation.status, 0, compilation.stderr || compilation.stdout);

    const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
    const evidenceProfile = runtime.assets.find((asset: any) => (
      asset.assetId === "EVIDENCE-P1-QINGLIU-REGISTER-ANOMALY"
    ));
    assert.equal(evidenceProfile?.assetType, "EVIDENCE_PROFILE");
    assert.deepEqual(
      evidenceProfile.adaptationDecisionIds,
      ["ADAPT-P1-QINGLIU-COUNTY", "ADAPT-P1-REGISTER-ALTERATION"],
    );
    assert.match(
      evidenceProfile.payload.openingReport.statement,
      /分户田数逐项相加，所得合计与册尾所列总数不符/,
    );
    assert.equal(
      evidenceProfile.payload.openingReport.statementClass,
      "ATTRIBUTED_UNVERIFIED_REPORT",
    );
    assert.ok(
      evidenceProfile.payload.openingReport.forbiddenAssertions.some((item: string) => (
        item.includes("墨色") && item.includes("印章")
      )),
    );
    assert.match(
      evidenceProfile.payload.openingBeatContract.objective,
      /内厅问答 beat/,
    );
    assert.equal(evidenceProfile.payload.openingBeatContract.moves.length, 4);
    assert.ok(
      evidenceProfile.payload.openingBeatContract.requiredAnchorGroups.some(
        (group: string[]) => group.includes("不知道") && group.includes("不知"),
      ),
    );
    assert.match(
      evidenceProfile.payload.openingBeatContract.stopCondition,
      /巡抚书吏仍在等待总督答复/,
    );
    const continuationDecisions = runtime.assets
      .filter((asset: any) => asset.assetType === "SECTION_FLOOR_OBLIGATION")
      .flatMap((asset: any) => asset.payload.continuationDecisions || []);
    assert.equal(continuationDecisions.length, 5, "the authored route needs one S3 bridge and four S4 follow-up decisions");
    assert.equal(new Set(continuationDecisions.map((item: any) => item.continuationDecisionId)).size, 5);
    for (const continuation of continuationDecisions) {
      assert.equal(continuation.options.length, 2, `${continuation.continuationDecisionId} must expose two readable responses`);
      assert.equal(new Set(continuation.options.map((item: any) => item.affordanceTemplateId)).size, 2);
      assert.ok(continuation.worldPressure.sourceFloorAssetId, `${continuation.continuationDecisionId} must remain traceable to a Floor Obligation`);
    }
    const approved = new Set(["UNKNOWN", "TRACEABLE", "FRAGILE", "COMPROMISED"]);
    const kernelAssets = runtime.assets.filter((asset: any) => asset.assetType === "DECISION_KERNEL");
    const chainStates = kernelAssets.flatMap((asset: any) =>
      (asset.payload.options || []).flatMap((option: any) => {
        const value = option.statePatch?.["evidence.chainStatus"];
        return value === undefined ? [] : [{ kernelId: asset.assetId, affordanceId: option.affordanceTemplateId, value }];
      })
    );

    assert.ok(chainStates.length > 0, "compiled decision kernels must include evidence-chain mutations");
    assert.deepEqual(
      chainStates.filter((entry: any) => !approved.has(entry.value)),
      [],
      "a descriptive substate must not strand a section outside its canonical exit-gate vocabulary"
    );
    const transferRoute = chainStates.find((entry: any) => entry.affordanceId === "DK-P1-EVIDENCE-CUSTODY-OPT-03");
    assert.equal(transferRoute?.value, "FRAGILE");

    let state = createInitialPartOneState(runtime);
    state = settlePartOneAction(runtime, state, {
      source: "RECOMMENDED",
      decisionId: "opening_d2",
      actionText: "先封档房，再复巡抚"
    }, 1).proposedState;
    const route = [0, -1, 0, -1, 0, -1];
    for (const [offset, selector] of route.entries()) {
      const turnNumber = offset + 2;
      const workingSet = buildPartOneRuntimeWorkingSet(runtime, state, turnNumber - 1);
      const affordance = selector === -1 ? workingSet.decisionAffordances.at(-1)! : workingSet.decisionAffordances[selector];
      state = settlePartOneAction(runtime, state, {
        source: "RECOMMENDED",
        decisionKernelId: affordance.decisionKernelId,
        affordanceTemplateId: affordance.affordanceTemplateId,
        label: affordance.title,
        actionText: affordance.actionText,
        targetRef: affordance.targetRef
      }, turnNumber).proposedState;
    }
    assert.equal(state.sectionId, "SEC-P1-03", "the former T08 branch must advance into the grain-and-land section");
    assert.equal(
      buildPartOneRuntimeWorkingSet(runtime, state, 7).retrievalTrace.decisionKernelId,
      "DK-P1-GRAIN-SOURCE",
      "T08 must not reopen an already completed witness-access decision"
    );

    const expectedRoute = [
      [8, "SEC-P1-03", "DK-P1-GRAIN-SOURCE", null],
      [9, "SEC-P1-03", "DK-P1-MERCHANT-CONDITIONS", null],
      [10, "SEC-P1-03", "DK-P1-LAND-SAFEGUARD", null],
      [11, "SEC-P1-03", "DK-P1-RELIEF-PRIORITY", null],
      [12, "SEC-P1-03", "DK-P1-RELIEF-PRIORITY", "CD-P1-S3-RELIEF-RECEIPTS"],
      [13, "SEC-P1-04", "DK-P1-REPORT-AUTHORSHIP", null],
      [14, "SEC-P1-04", "DK-P1-EVIDENCE-ATTACHMENT", null],
      [15, "SEC-P1-04", "DK-P1-RESPONSIBILITY-SCOPE", null],
      [16, "SEC-P1-04", "DK-P1-CAPITAL-CHANNEL", null],
      [17, "SEC-P1-04", "DK-P1-REPORT-AUTHORSHIP", "CD-P1-S4-XUNFU-COPY-REQUEST"],
      [18, "SEC-P1-04", "DK-P1-RESPONSIBILITY-SCOPE", "CD-P1-S4-MERCHANT-DAILY-TERMS"],
      [19, "SEC-P1-04", "DK-P1-EVIDENCE-ATTACHMENT", "CD-P1-S4-WITNESS-PROTECTION-ORDER"],
      [20, "SEC-P1-04", "DK-P1-CAPITAL-CHANNEL", "CD-P1-S4-WAITING-FOR-CAPITAL"],
    ] as const;
    const seenAffordanceIds = new Set<string>();
    const seenActionTexts = new Set<string>();
    for (const [turnNumber, expectedSection, expectedKernel, expectedContinuation] of expectedRoute) {
      const workingSet = buildPartOneRuntimeWorkingSet(runtime, state, turnNumber - 1);
      assert.equal(workingSet.section.sectionId, expectedSection, `T${turnNumber} section`);
      assert.equal(workingSet.retrievalTrace.decisionKernelId, expectedKernel, `T${turnNumber} kernel`);
      assert.equal(workingSet.retrievalTrace.continuationDecisionId, expectedContinuation, `T${turnNumber} continuation`);
      assert.equal(workingSet.decisionAffordances.length, 2, `T${turnNumber} must show exactly two decisions`);
      if (expectedContinuation) {
        assert.ok(workingSet.nextDecisionPressure?.summary, `T${turnNumber} continuation must arrive through a visible world pressure`);
        assert.ok(workingSet.retrievalTrace.floorObligationId, `T${turnNumber} continuation must cite its Floor Obligation`);
      } else {
        assert.equal(workingSet.nextDecisionPressure, null);
      }
      for (const affordance of workingSet.decisionAffordances) {
        assert.equal(seenAffordanceIds.has(affordance.affordanceTemplateId), false, `T${turnNumber} repeated affordance ${affordance.affordanceTemplateId}`);
        assert.equal(seenActionTexts.has(affordance.actionText), false, `T${turnNumber} repeated action text`);
        seenAffordanceIds.add(affordance.affordanceTemplateId);
        seenActionTexts.add(affordance.actionText);
      }
      const affordance = turnNumber % 2 === 0 ? workingSet.decisionAffordances[0] : workingSet.decisionAffordances.at(-1)!;
      const settlement = settlePartOneAction(runtime, state, {
        source: "RECOMMENDED",
        decisionKernelId: affordance.decisionKernelId,
        affordanceTemplateId: affordance.affordanceTemplateId,
        label: affordance.title,
        actionText: affordance.actionText,
        targetRef: affordance.targetRef
      }, turnNumber);
      assert.equal(settlement.appliedAffordance?.affordanceTemplateId, affordance.affordanceTemplateId, `T${turnNumber} must settle the visible choice`);
      const finalized = finalizePartOneSettlement(settlement, settlement.dueConsequences.map((item) => item.consequenceId));
      const report = buildPartOneTurnProgressReport(runtime, finalized, {
        runId: "compile-regression-route",
        playerActionId: `action-${turnNumber}`,
        paidPendingConsequenceIds: settlement.dueConsequences.map((item) => item.consequenceId)
      });
      assert.equal(report.hardValidationStatus, "PASS", `T${turnNumber} must produce objective progress`);
      state = finalized.proposedState;
    }
    assert.equal(state.turnNumber, 20);
    assert.equal(state.sectionId, "SEC-P1-04");
    assert.equal(state.partCompletionStatus, "HANDOFF_READY");
    assert.equal(new Set(state.completedKernelIds).size, 15, "all fifteen primary kernels must resolve exactly once");
    const terminal = buildPartOneRuntimeWorkingSet(runtime, state, 20);
    assert.equal(terminal.openDecisionKernel.assetId, "PART-02-HANDOFF-PREVIEW");
    assert.equal(terminal.retrievalTrace.continuationDecisionId, "PART-02-HANDOFF-PREVIEW");
    assert.equal(terminal.retrievalTrace.floorObligationId, null);
    assert.equal(terminal.decisionAffordances.length, 2);
    assert.equal(terminal.openDecisionKernel.payload.terminalReadOnlyPreview, true);
    assert.ok(terminal.decisionAffordances.every((item) => item.createsPendingConsequence === false));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
