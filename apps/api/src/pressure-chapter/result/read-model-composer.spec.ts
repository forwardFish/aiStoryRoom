import assert from "node:assert/strict";
import test from "node:test";
import {
  recomputeAuthorityResultSnapshotHashV1,
} from "@ai-story/shared";
import { PressureResultReadError } from "./errors";
import type { PressureResultReadModelInputReaderPort } from "./ports";
import { PressureResultReadModelComposerV1 } from "./read-model-composer";
import {
  pressureResultReadModelInputFixture,
} from "./result-test-fixtures";

function harness(input: unknown = pressureResultReadModelInputFixture()) {
  const counters = {
    consistentReads: 0,
    authorityWrites: 0,
    narrativeWrites: 0,
    providerCalls: 0,
    settlementCalls: 0,
    finaleCalls: 0,
  };
  const reader = {
    async readConsistentSource() {
      counters.consistentReads += 1;
      return structuredClone(input);
    },
    async writeAuthority() { counters.authorityWrites += 1; },
    async writeNarrative() { counters.narrativeWrites += 1; },
    async callProvider() { counters.providerCalls += 1; },
    async settle() { counters.settlementCalls += 1; },
    async decideFinale() { counters.finaleCalls += 1; },
  } satisfies PressureResultReadModelInputReaderPort & Record<string, unknown>;
  return {
    composer: new PressureResultReadModelComposerV1(reader),
    counters,
  };
}

test("one consistent read composes authority plus six PENDING narratives without mutation", async () => {
  const input = pressureResultReadModelInputFixture();
  const snapshotHash = (input.authority as any).snapshotHash as string;
  const { composer, counters } = harness(input);
  const source = await composer.readFinalized("run-pressure-1");

  assert.ok(source);
  assert.equal(source.authority.snapshotHash, snapshotHash);
  assert.equal(
    recomputeAuthorityResultSnapshotHashV1(source.authority),
    snapshotHash,
  );
  assert.equal(source.narratives.length, 6);
  assert.ok(source.narratives.every((item) => item.status === "PENDING"));
  assert.ok(Object.isFrozen(source));
  assert.ok(Object.isFrozen(source.authority));
  assert.deepEqual(counters, {
    consistentReads: 1,
    authorityWrites: 0,
    narrativeWrites: 0,
    providerCalls: 0,
    settlementCalls: 0,
    finaleCalls: 0,
  });
});

test("narrative PENDING to PUBLISHED changes read-model presentation only", async () => {
  const pendingInput = pressureResultReadModelInputFixture("MULTIPLAYER", "PENDING");
  const publishedInput = pressureResultReadModelInputFixture("MULTIPLAYER", "PUBLISHED");
  const pending = await harness(pendingInput).composer.readFinalized("run-pressure-1");
  const published = await harness(publishedInput).composer.readFinalized("run-pressure-1");

  assert.ok(pending && published);
  assert.deepEqual(published.authority, pending.authority);
  assert.equal(published.authority.snapshotHash, pending.authority.snapshotHash);
  assert.ok(pending.narratives.every((item) => item.text === null));
  assert.ok(published.narratives.every((item) => item.text?.startsWith("NARRATIVE_FOR_")));
});

test("missing, duplicate or source-mismatched narrative projections fail closed", async () => {
  const missing = pressureResultReadModelInputFixture() as any;
  missing.narrativeReadSet = null;
  await rejectsStoredInvalid(harness(missing).composer.readFinalized("run-pressure-1"));

  const short = pressureResultReadModelInputFixture() as any;
  short.narrativeReadSet.narratives.pop();
  await rejectsStoredInvalid(harness(short).composer.readFinalized("run-pressure-1"));

  const duplicate = pressureResultReadModelInputFixture() as any;
  duplicate.narrativeReadSet.narratives[1].seatId =
    duplicate.narrativeReadSet.narratives[0].seatId;
  await rejectsStoredInvalid(harness(duplicate).composer.readFinalized("run-pressure-1"));

  const mismatch = pressureResultReadModelInputFixture() as any;
  mismatch.narrativeReadSet.sourceCommitHash = "f".repeat(64);
  await rejectsStoredInvalid(harness(mismatch).composer.readFinalized("run-pressure-1"));
});

test("authority snapshot tampering fails before any narrative can replace it", async () => {
  const tampered = pressureResultReadModelInputFixture() as any;
  tampered.authority.worldOutcome.title = "Narrative tried to rewrite authority";
  const { composer, counters } = harness(tampered);
  await rejectsStoredInvalid(composer.readFinalized("run-pressure-1"));
  assert.equal(counters.consistentReads, 1);
  assert.equal(counters.providerCalls, 0);
  assert.equal(counters.authorityWrites, 0);
});

async function rejectsStoredInvalid(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof PressureResultReadError &&
      error.code === "RESULT_STORED_RECORD_INVALID",
  );
}
