import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  type ParticipantModeV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type { PressureChapterBeatClosureAuthorityV1 } from "@ai-story/templates";
import type {
  BeatSubmitControllerAuthorityV1,
  BeatSubmitPolicyInputV1,
} from "./contracts";
import {
  BEAT_SUBMIT_POLICY_ERROR_CODES_V1 as ERROR,
  BeatSubmitPolicyErrorV1,
  BeatSubmitPolicyV1,
  computeBeatSubmitPolicyInputHashV1,
  planBeatSubmitV1,
} from "./policy";

const SEATS = [...PRESSURE_CHAPTER_SEAT_IDS_V1];
const HUMAN = SEATS.at(-1)!;

function topology(
  humanSeatIds: readonly SeatIdV1[],
  completedSeatIds: readonly SeatIdV1[] = [],
): BeatSubmitControllerAuthorityV1[] {
  return SEATS.map((seatId, index) => ({
    seatId,
    mode: humanSeatIds.includes(seatId) ? "HUMAN_ACTIVE" : "AI_ACTIVE",
    activeControllerId: humanSeatIds.includes(seatId) ? `human-${seatId}` : `ai-${seatId}`,
    controlEpoch: index + 1,
    authorityStateHash: (index + 1).toString(16).padStart(64, "0"),
    requiresResolution: !completedSeatIds.includes(seatId),
  }));
}

function input(options: Readonly<{
  beat: PressureChapterBeatClosureAuthorityV1;
  participantMode?: ParticipantModeV1;
  viewerSeatId?: SeatIdV1;
  humanSeatIds?: readonly SeatIdV1[];
  requiredSeatIds?: readonly SeatIdV1[];
  completedSeatIds?: readonly SeatIdV1[];
}>): BeatSubmitPolicyInputV1 {
  const viewerSeatId = options.viewerSeatId ?? HUMAN;
  const withoutHash = {
    schemaVersion: "pressure_beat_submit_policy_input_v1" as const,
    beat: options.beat,
    participantMode: options.participantMode ?? "SOLO" as const,
    viewerSeatId,
    requiredSeatIds: [...(options.requiredSeatIds ?? SEATS)],
    controllerTopology: topology(options.humanSeatIds ?? [viewerSeatId], options.completedSeatIds),
  };
  return { ...withoutHash, inputHash: computeBeatSubmitPolicyInputHashV1(withoutHash) };
}

function codeOf(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof BeatSubmitPolicyErrorV1 && error.code === code);
}

test("N1.B01-B07 are intermediate and N1.B08 alone plans five Solo NPC seats plus Settlement", () => {
  for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
    const plan = planBeatSubmitV1(input({ beat: { beatId: `N1.B${String(ordinal).padStart(2, "0")}`, closesChapter: ordinal === 8 } }));
    assert.deepEqual(plan.humanSubmissionSeatIds, [HUMAN]);
    if (ordinal < 8) {
      assert.equal(plan.mode, "INTERMEDIATE_ACTION_ONLY");
      assert.deepEqual(plan.npcResolutionSeatIds, []);
      assert.equal(plan.invokeSettlement, false);
    } else {
      assert.equal(plan.mode, "CHAPTER_COUNCIL_COMMIT");
      assert.deepEqual(plan.npcResolutionSeatIds, SEATS.filter((seatId) => seatId !== HUMAN));
      assert.equal(plan.invokeSettlement, true);
      assert.equal(new Set(plan.npcResolutionSeatIds).size, 5);
    }
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(Object.isFrozen(plan.npcResolutionSeatIds), true);
  }
});

test("generic N2-N7 fixtures use closesChapter as the only close authority", () => {
  for (let chapter = 2; chapter <= 7; chapter += 1) {
    const beatCount = chapter + 1;
    for (let ordinal = 1; ordinal <= beatCount; ordinal += 1) {
      const closesChapter = ordinal === beatCount;
      const plan = new BeatSubmitPolicyV1().plan(input({ beat: { beatId: `N${chapter}.B${String(ordinal).padStart(2, "0")}`, closesChapter } }));
      assert.equal(plan.mode, closesChapter ? "CHAPTER_COUNCIL_COMMIT" : "INTERMEDIATE_ACTION_ONLY");
      assert.equal(plan.invokeSettlement, closesChapter);
      assert.equal(plan.npcResolutionSeatIds.length, closesChapter ? 5 : 0);
    }
  }
});

test("Multiplayer final Beat includes only pending AI-controlled required seats and never human seats", () => {
  const humanSeatIds = [SEATS[0]!, SEATS[2]!, HUMAN];
  const completedAiSeat = SEATS[1]!;
  const plan = planBeatSubmitV1(input({
    beat: { beatId: "N4.B05", closesChapter: true },
    participantMode: "MULTIPLAYER",
    viewerSeatId: HUMAN,
    humanSeatIds,
    completedSeatIds: [completedAiSeat],
  }));
  assert.deepEqual(plan.npcResolutionSeatIds, SEATS.filter((seatId) => !humanSeatIds.includes(seatId) && seatId !== completedAiSeat));
  assert.equal(plan.npcResolutionSeatIds.some((seatId) => humanSeatIds.includes(seatId)), false);
});

test("non-required AI seats never enter the chapter council plan", () => {
  const requiredSeatIds = [SEATS[0]!, SEATS[3]!, HUMAN];
  const plan = planBeatSubmitV1(input({ beat: { beatId: "N6.B04", closesChapter: true }, requiredSeatIds }));
  assert.deepEqual(plan.npcResolutionSeatIds, [SEATS[0]!, SEATS[3]!]);
});

test("replay is deterministic", () => {
  const command = input({ beat: { beatId: "C42.B02", closesChapter: true } });
  assert.deepEqual(planBeatSubmitV1(structuredClone(command)), planBeatSubmitV1(command));
});

test("authority drift and invalid seats fail closed", () => {
  codeOf(() => planBeatSubmitV1(input({ beat: { beatId: "N3.B01", closesChapter: false }, viewerSeatId: SEATS[0]!, humanSeatIds: [HUMAN] })), ERROR.VIEWER_NOT_ACTIVE_HUMAN);

  const duplicate = input({ beat: { beatId: "N3.B01", closesChapter: false } });
  duplicate.controllerTopology = [...duplicate.controllerTopology, { ...duplicate.controllerTopology[0]! }];
  duplicate.inputHash = computeBeatSubmitPolicyInputHashV1({
    schemaVersion: duplicate.schemaVersion,
    beat: duplicate.beat,
    participantMode: duplicate.participantMode,
    viewerSeatId: duplicate.viewerSeatId,
    requiredSeatIds: duplicate.requiredSeatIds,
    controllerTopology: duplicate.controllerTopology,
  });
  codeOf(() => planBeatSubmitV1(duplicate), ERROR.INVALID_INPUT);

  const tampered = input({ beat: { beatId: "N3.B01", closesChapter: false } });
  tampered.beat = { ...tampered.beat, closesChapter: true };
  codeOf(() => planBeatSubmitV1(tampered), ERROR.AUTHORITY_MISMATCH);

  const unknown = input({ beat: { beatId: "N3.B01", closesChapter: false } });
  unknown.requiredSeatIds = ["unknown" as SeatIdV1, HUMAN];
  unknown.inputHash = computeBeatSubmitPolicyInputHashV1({
    schemaVersion: unknown.schemaVersion,
    beat: unknown.beat,
    participantMode: unknown.participantMode,
    viewerSeatId: unknown.viewerSeatId,
    requiredSeatIds: unknown.requiredSeatIds,
    controllerTopology: unknown.controllerTopology,
  });
  codeOf(() => planBeatSubmitV1(unknown), ERROR.INVALID_INPUT);
});

test("production policy has no database, Provider, Settlement, or Narrative dependency", () => {
  const source = readFileSync(path.resolve(__dirname, "policy.ts"), "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(imports, ["@ai-story/shared", "./contracts"]);
  for (const forbidden of [
    /@prisma\/client/u,
    /\bdeepseek\b/iu,
    /\bproviderClient\b/iu,
    /\bsettlementService\b/iu,
    /\bnarrativeService\b/iu,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
