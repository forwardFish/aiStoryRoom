import { PressureKernelError } from "./errors";
import { clonePressureValue, pressureHash } from "./canonical";
import { canonicalizePressureActionIntent, fingerprintPressureActionIntent } from "./compiler";
import { previewPressureActionIntent } from "./guard";
import type {
  PressureActionIntentCommandV1,
  PressureActionPreview,
  PressureRuntimeContent,
  PressureRuntimeState,
} from "./types";

export { canonicalizePressureActionIntent, previewPressureActionIntent };

export function pressureActionRequestFingerprint(intent: PressureActionIntentCommandV1): string {
  return fingerprintPressureActionIntent(intent);
}

export function validatePressureActionIntent(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  intent: unknown,
): PressureActionPreview {
  return clonePressureValue(previewPressureActionIntent(state, content, intent).preview);
}

export function assertPressurePreviewToken(
  state: PressureRuntimeState,
  preview: PressureActionPreview,
  previewToken?: string,
): void {
  if (!previewToken) throw new PressureKernelError("PREVIEW_REQUIRED", "A validated preview token is required");
  if (previewToken !== preview.previewToken) throw new PressureKernelError("PREVIEW_TAMPERED", "Preview token mismatch");
  if (preview.normalizedIntent.runId !== state.runId || preview.normalizedIntent.nodeId !== state.nodeId) {
    throw new PressureKernelError("PREVIEW_STALE", "Preview targets another run/node");
  }
  if (preview.normalizedIntent.expectedSnapshotHash !== state.inputSnapshotHash
    || preview.normalizedIntent.expectedRunVersion !== state.phaseSnapshotVersion) {
    throw new PressureKernelError("PREVIEW_STALE", "Preview snapshot is stale");
  }
  if (pressureHash(preview.normalizedIntent) !== preview.actionFingerprint) {
    throw new PressureKernelError("PREVIEW_TAMPERED", "Preview action fingerprint drifted");
  }
}
