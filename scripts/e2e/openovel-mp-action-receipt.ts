export type OpenNovelActionReceipt = {
  resolutionId: string;
  appliedWorldSequence: number;
  deferred: boolean;
};

export function parseOpenNovelActionReceipt(status: number, payload: unknown): OpenNovelActionReceipt {
  const body = record(payload) ? payload : {};
  if (status >= 200 && status < 300) {
    const resolution = record(body.resolution) ? body.resolution : {};
    if (body.accepted !== true) throw new Error("ACTION_NOT_ACCEPTED");
    return receipt(resolution, false);
  }

  const details = record(body.details) ? body.details : body;
  const code = String(details.code || body.code || "");
  if (status === 503 && code === "STORY_GENERATION_IN_PROGRESS" && details.recoverable === true) {
    return receipt({ id: details.resolutionId, appliedWorldSequence: details.appliedWorldSequence }, true);
  }
  throw new Error(`ACTION_HTTP_${status}:${JSON.stringify(body)}`);
}

function receipt(value: Record<string, unknown>, deferred: boolean): OpenNovelActionReceipt {
  const resolutionId = String(value.id || "").trim();
  const appliedWorldSequence = Number(value.appliedWorldSequence);
  if (!resolutionId || !Number.isInteger(appliedWorldSequence) || appliedWorldSequence < 1) {
    throw new Error("ACTION_RECEIPT_INVALID");
  }
  return { resolutionId, appliedWorldSequence, deferred };
}

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
