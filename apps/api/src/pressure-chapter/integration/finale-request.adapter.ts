import { validateAtomicChapterCommitRecordV1 } from "../chapter-settlement/chapter-commit-record";
import type { FinaleRequestPort } from "../orchestrator/contracts";
import { failPressureChapterIntegration } from "./errors";

/** Read-only W1 seam over the N7 record already atomically committed by W6. */
export interface DurableN7FinaleHandoffReaderPort {
  readCommittedN7Handoff(input: Readonly<{
    runId: string;
    n7FrozenBundleHash: string;
  }>): Promise<unknown | null>;
}

/**
 * W6 already creates COMPUTE_FINALE in the same transaction as N7 Frozen.
 * W4 therefore only confirms that exact durable handoff. It never inserts a
 * second task and never invokes Finale, Result or a Provider synchronously.
 */
export class ExistingN7FinaleOutboxConfirmationAdapterV1
implements FinaleRequestPort {
  constructor(private readonly reader: DurableN7FinaleHandoffReaderPort) {}

  async request(
    input: Parameters<FinaleRequestPort["request"]>[0],
  ): Promise<Awaited<ReturnType<FinaleRequestPort["request"]>>> {
    requiredText(input.runId, "finale.runId");
    hash(input.routeHash, "finale.routeHash");
    hash(input.n7FrozenBundleHash, "finale.n7FrozenBundleHash");
    const expectedIdempotencyKey = [
      "pressure-finale",
      input.runId,
      input.n7FrozenBundleHash,
    ].join(":");
    if (input.idempotencyKey !== expectedIdempotencyKey) {
      mismatch("finale.idempotencyKey", "EXPECTED_FROZEN_BUNDLE_KEY");
    }
    const raw = await this.reader.readCommittedN7Handoff({
      runId: input.runId,
      n7FrozenBundleHash: input.n7FrozenBundleHash,
    });
    if (!raw) {
      mismatch("finale.handoff", "COMMITTED_N7_OUTBOX_MISSING");
    }
    const record = validateAtomicChapterCommitRecordV1(raw);
    if (
      record.runId !== input.runId
      || record.chapterId !== "N7"
      || record.sealedInput.runRouteHash !== input.routeHash
      || record.frozenChapterBundle.bundleHash !== input.n7FrozenBundleHash
      || record.outbox.taskType !== "COMPUTE_FINALE"
      || record.outbox.status !== "PENDING"
      || record.outbox.runId !== input.runId
      || record.outbox.sourceBundleHash !== input.n7FrozenBundleHash
      || record.outbox.target.kind !== "FINALE"
      || record.outbox.target.chapterId !== null
    ) {
      mismatch("finale.handoff", "N7_FROZEN_OUTBOX_BINDING_MISMATCH");
    }
    // It was requested atomically by W6 before W4 reached this confirmation.
    return { status: "REPLAYED" };
  }
}

function requiredText(value: string, path: string): void {
  if (typeof value !== "string" || !value.trim()) {
    mismatch(path, "NON_EMPTY_STRING");
  }
}

function hash(value: string, path: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) mismatch(path, "SHA256_LOWER_HEX");
}

function mismatch(path: string, detail?: string): never {
  return failPressureChapterIntegration(
    "INTEGRATION_FINALE_REQUEST_MISMATCH",
    path,
    detail,
  );
}
