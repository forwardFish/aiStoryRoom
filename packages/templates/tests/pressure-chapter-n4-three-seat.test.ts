import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadSangtianPressureChapterPackageV1 } from "../src/pressure-chapter/content";
import { loadPublishedSangtianAiDecisionPolicyV1 } from "../src/pressure-chapter/release/ai-decision-policy";

const PERMANENT_PLAYER_SEATS = [
  "jiangnan_merchant",
  "zhejiang_administration",
  "zhejiang_governor",
] as const;

test("N4 keeps all three permanent player seats actionable in both formal decisions", async () => {
  const content = loadSangtianPressureChapterPackageV1().content;
  const chapter = content.chapters.find((candidate) => candidate.chapterId === "N4");
  assert.ok(chapter);
  assert.deepEqual(
    chapter.decisionPoints.map((decision) => decision.decisionPointKey),
    ["N4.prisoner_review", "N4.case_file_seal"],
  );
  for (const decision of chapter.decisionPoints) {
    for (const seatId of PERMANENT_PLAYER_SEATS) {
      assert.ok(
        decision.requiredSeatIds.includes(seatId),
        `${seatId} must be actionable at ${decision.decisionPointKey}`,
      );
    }
  }

  const ai = loadPublishedSangtianAiDecisionPolicyV1().policy;
  for (const decision of ai.decisions.filter((candidate) => candidate.chapterId === "N4")) {
    assert.deepEqual(
      decision.seatPolicies
        .map((seat) => seat.seatId)
        .filter((seatId) => PERMANENT_PLAYER_SEATS.includes(seatId as typeof PERMANENT_PLAYER_SEATS[number]))
        .sort(),
      [...PERMANENT_PLAYER_SEATS].sort(),
    );
  }

  const policyPath = fileURLToPath(new URL(
    "../config/sangtian/pressure-chapter-v1/release/action-effect-policy.json",
    import.meta.url,
  ));
  const effectPolicy = JSON.parse(await readFile(policyPath, "utf8")) as {
    chapterPolicies: Array<{
      chapterId: string;
      decisions: Array<{ decisionPointKey: string; requiredSeatIds: string[] }>;
    }>;
  };
  const n4Effects = effectPolicy.chapterPolicies.find((candidate) => candidate.chapterId === "N4");
  assert.ok(n4Effects);
  for (const decision of n4Effects.decisions) {
    for (const seatId of PERMANENT_PLAYER_SEATS) {
      assert.ok(decision.requiredSeatIds.includes(seatId));
    }
  }
});
