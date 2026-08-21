import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "prisma-snapshot.ts"), "utf8");

test("Prisma convergence snapshot captures route, W4, W5 and SeatControl in one bounded transaction", () => {
  // One submit capture plus one post-transition single-row projection-cache
  // read. Each public operation is still bounded by exactly one transaction.
  assert.equal((source.match(/pressureFastSerializableTransaction\(/gu) ?? []).length, 2);
  assert.equal((source.match(/return pressureFastSerializableTransaction\(this\.prisma/gu) ?? []).length, 2);
  assert.match(
    source,
    /loadWorkingProjection[\s\S]*?return pressureFastSerializableTransaction\(this\.prisma/gu,
  );
  assert.match(
    source,
    /private async captureInternal[\s\S]*?return pressureFastSerializableTransaction\(this\.prisma/gu,
  );
  assert.match(source, /pressureRunRouteSnapshot\.findUnique/u);
  assert.match(source, /readCurrentOrchestratorState\(tx/u);
  assert.match(source, /pressureChapterRuntime\.findUnique/u);
  assert.match(source, /pressureSeatControlSnapshot\.findUnique/u);
  assert.match(source, /captureSubmit/u);
  assert.match(source, /storyPlayer\.findUnique/u);
  assert.match(source, /STALE_OR_NOT_AUTHORIZED/u);
  assert.match(source, /mismatchKeys:\s*authorityMismatches/u);
  assert.match(source, /"decision\.point"/u);
  assert.match(source, /"working\.revision"/u);
  assert.match(source, /"control\.fence"/u);
  assert.match(source, /ledgerProjectionJson:\s*true/u);
  assert.match(source, /decodeWorkingLedgerProjectionCacheV1/u);
  assert.doesNotMatch(source, /projectWorkingLedger|readLedgerEvents/u);
  assert.match(source, /TransactionIsolationLevel\.Serializable/u);
  assert.match(source, /maxWait:\s*500/u);
  assert.match(source, /timeout:\s*10_000/u);
});

test("HTTP submit membership is joined inside the same snapshot transaction", () => {
  assert.match(
    source,
    /private async captureInternal[\s\S]*?return pressureFastSerializableTransaction\(this\.prisma[\s\S]*?runId_userId/gu,
  );
  assert.match(source, /runId_userId/u);
  assert.match(source, /seat\.submissionFenceToken !== submit\.expectedSubmissionFenceToken/u);
  assert.match(source, /withDecisionSubmitSnapshotHashV1/u);
  assert.match(source, /captureSubmitAuthority/u);
  assert.match(source, /currentIndependentSeatDecisionPointV1/u);
  assert.match(source, /!independentSeatFlow && activeSeat\?\.requirement/u);
});

test("snapshot transaction performs no policy, content, Provider or write operation", () => {
  assert.doesNotMatch(source, /policy\.select|content\.load|fetch\s*\(|provider/iu);
  assert.doesNotMatch(source, /\.create\s*\(|\.update(?:Many)?\s*\(|\.delete(?:Many)?\s*\(/u);
});
