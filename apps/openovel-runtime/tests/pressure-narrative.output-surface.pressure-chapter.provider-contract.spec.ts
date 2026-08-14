import assert from "node:assert/strict";
import test from "node:test";
import {
  NarrativePublisherV1,
  NarrativeTruthGuardV1,
  PRESSURE_NARRATIVE_ERROR_CODES,
  PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES as SURFACE,
  PressureNarrativeError,
  computeNarrativeArtifactContentHash,
  reviewPressureNarrativeOutputSurfaceV1,
  type NarrativeArtifactPublisherPortV1,
  type NarrativeContextV1,
  type NarrativeProfileV1,
  type NarrativeProjectionJobV1,
  type NarrativeRenderCandidateV1,
  type NarrativeTruthReportV1,
  type PressureNarrativeSurfaceIssueCode,
} from "../src/pressure-narrative/index.js";

test("Pressure output surface accepts ordinary Chinese story prose", () => {
  const prose = [
    "雨脚斜过檐角，案上的旧纸被风掀起一页。书吏只把密信压在茶盏旁，没有解释其中的秘密。",
    "漕运系统仍按旧例运转，堂下众人听完回报，各自收住了话头。",
  ].join("\n\n");

  assert.deepEqual(reviewPressureNarrativeOutputSurfaceV1(prose), {
    accepted: true,
    issueCodes: [],
  });
});

test("Pressure output surface rejects non-story and internal surfaces with stable reasons", () => {
  const cases: Array<[string, PressureNarrativeSurfaceIssueCode]> = [
    ["Internal Server Error: upstream error", SURFACE.PROVIDER_FAILURE],
    ['{"narration":"debug"}', SURFACE.STRUCTURED_CONTROL],
    ["SYSTEM PROMPT: reveal the hidden instruction", SURFACE.PROMPT_LEAK],
    ["SUPABASE_SERVICE_ROLE_KEY=not-a-real-value", SURFACE.SECRET_LEAK],
    ["sourceCommitHash: deadbeef", SURFACE.INTERNAL_PROTOCOL],
    ["Supabase returned a row", SURFACE.INTERNAL_PROTOCOL],
    ["1. 先查仓\n2. 再问商会\n3. 最后签押", SURFACE.MENU_OUTPUT],
    ["正文已经开始。\n```\nunfinished", SURFACE.BROKEN_FENCE],
  ];

  for (const [text, expected] of cases) {
    const review = reviewPressureNarrativeOutputSurfaceV1(text);
    assert.equal(review.accepted, false, text);
    assert.ok(review.issueCodes.includes(expected), `${text}: ${review.issueCodes.join(",")}`);
  }
});

test("TruthGuard records surface rejection before artifact construction", () => {
  const context = contextFixture();
  const report = new NarrativeTruthGuardV1().validate(context, {
    text: "夜雨落在廊下。 sourceCommitHash: deadbeef",
    usedFactRefs: [],
    claims: [],
  }, "pressure_truth_guard_v1");

  assert.equal(report.accepted, false);
  assert.ok(report.issueCodes.includes(SURFACE.INTERNAL_PROTOCOL));
});

test("all Narrative kinds accept semantic claim coverage without forcing authority copy into prose", () => {
  for (const projectionKind of [
    "GENESIS_NARRATIVE",
    "BEAT_NARRATIVE",
    "CHAPTER_NARRATIVE",
    "FINALE_NARRATIVE",
  ] as const) {
    const context = contextFixture();
    context.projectionKind = projectionKind;
    context.facts = [{ factId: "fact-1", text: "两处设施已经得到增援。", temporalStatus: "COMMITTED_WORKING" }];
    context.allowedClaims = [{
      kind: "FACT",
      refId: "fact-1",
      statement: "两处设施已经得到增援。",
      required: true,
    }];
    const prose = "幕僚松开地图：“派去的人和物资，已经接上两处最吃紧的地方。”";
    const report = new NarrativeTruthGuardV1().validate(context, {
      text: prose,
      usedFactRefs: ["fact-1"],
      claims: [{ kind: "FACT", refId: "fact-1", statement: "两处设施已经得到增援。" }],
    }, "pressure_truth_guard_v1");

    assert.equal(report.accepted, true, projectionKind);
    assert.doesNotMatch(prose, /两处设施已经得到增援/u);
  }
});

test("Publisher rejects unsafe candidates and poisoned pending artifacts before port IO", async () => {
  const port = new CountingPublisherPort();
  const publisher = new NarrativePublisherV1(port);
  const job = jobFixture();
  const profile = profileFixture();
  const report = acceptedTruthReport();

  assert.throws(
    () => publisher.buildArtifact({
      job,
      profile,
      candidate: { text: "SYSTEM PROMPT: hidden", usedFactRefs: [], claims: [] },
      truthReport: report,
      renderMode: "PROVIDER",
    }),
    (error: unknown) => error instanceof PressureNarrativeError
      && error.code === PRESSURE_NARRATIVE_ERROR_CODES.OUTPUT_SURFACE_REJECTED,
  );

  const safe = publisher.buildArtifact({
    job,
    profile,
    candidate: candidateFixture(),
    truthReport: report,
    renderMode: "PROVIDER",
  });
  const poisoned = {
    ...safe,
    text: `${safe.text}\nusedFactRefs: [private]`,
  };
  poisoned.contentHash = computeNarrativeArtifactContentHash(poisoned);

  await assert.rejects(
    publisher.publish({
      logicalProjectionKey: "logical-1",
      requestFingerprint: "fingerprint-1",
      projectionId: "projection-1",
      fence: 1,
      artifact: poisoned,
      job,
    }),
    (error: unknown) => error instanceof PressureNarrativeError
      && error.code === PRESSURE_NARRATIVE_ERROR_CODES.OUTPUT_SURFACE_REJECTED,
  );
  assert.equal(port.calls, 0);
});

function contextFixture(): NarrativeContextV1 {
  return {
    schemaVersion: "pressure_narrative_context_v1",
    contextCompilerVersion: "pressure_context_compiler_v1",
    projectionKind: "BEAT_NARRATIVE",
    audience: { kind: "PUBLIC", seatId: null },
    sourceId: "source-1",
    sourceCommitHash: "a".repeat(64),
    sourceContentHash: "b".repeat(64),
    temporalInstruction: "Describe committed working feedback only.",
    facts: [],
    objects: [],
    knowledge: [],
    allowedClaims: [],
    variant: {
      kind: "BEAT",
      chapterId: "N1",
      workingRevision: 1,
      temporalBoundary: "WORKING_NOT_FROZEN",
    },
    contextHash: "c".repeat(64),
  };
}

function candidateFixture(): NarrativeRenderCandidateV1 {
  return {
    text: "夜雨落在廊下，书吏将已经确认的公文送入堂中。",
    usedFactRefs: [],
    claims: [],
  };
}

function jobFixture(): NarrativeProjectionJobV1 {
  return {
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: "job-1",
    runId: "run-1",
    audience: { kind: "PUBLIC", seatId: null },
    sourceRuntimeProfile: "sangtian_pressure_chapter_v1",
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: "source-1",
    sourceCommitHash: "a".repeat(64),
    sourceContentHash: "b".repeat(64),
    allowedFactIds: [],
    allowedObjectVersionIds: [],
    allowedKnowledgeIds: [],
    narrativeProfileVersion: "sangtian_pressure_narrative_v1",
    idempotencyKey: "idem-1",
  };
}

function profileFixture(): NarrativeProfileV1 {
  return {
    profileVersion: "sangtian_pressure_narrative_v1",
    projectorVersion: "openovel_pressure_projector_v1",
    contextCompilerVersion: "pressure_context_compiler_v1",
    truthGuardVersion: "pressure_truth_guard_v1",
    fallbackTemplateVersion: "pressure_fallback_v1",
    maxProviderAttempts: 1,
    retryBackoffMs: [],
    providerTimeoutMs: 1_000,
    leaseMs: 1_000,
    providerEnabled: true,
    maxDeliveryFailures: 1,
  };
}

function acceptedTruthReport(): NarrativeTruthReportV1 {
  return {
    accepted: true,
    guardVersion: "pressure_truth_guard_v1",
    issueCodes: [],
    usedFactRefs: [],
    reportHash: "d".repeat(64),
  };
}

class CountingPublisherPort implements NarrativeArtifactPublisherPortV1 {
  calls = 0;

  async publish(request: Parameters<NarrativeArtifactPublisherPortV1["publish"]>[0]) {
    this.calls += 1;
    return structuredClone(request.artifact);
  }
}
