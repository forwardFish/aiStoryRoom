import { HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";

export type OpenNovelReplayInput = {
  runId: string;
  action: string;
  submissionId: string;
  boundOption?: { id: string; label: string } | null;
};

/**
 * Re-enters the existing runtime action endpoint without an expected revision.
 * The Runtime's atomic Head checks the submission id before any model call, so
 * a committed turn is replayed from Canon while an uncommitted submission may
 * safely resume behind the Runtime's foreground lease.
 */
@Injectable()
export class OpenNovelTurnReplayClient {
  private readonly baseUrl = String(
    process.env.OPENOVEL_RUNTIME_URL || "http://127.0.0.1:3110",
  ).replace(/\/+$/, "");
  private readonly token = String(process.env.OPENOVEL_INTERNAL_TOKEN || "").trim();

  async replay(input: OpenNovelReplayInput): Promise<any> {
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/internal/openovel/runs/${encodeURIComponent(input.runId)}/actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          },
          body: JSON.stringify({
            action: input.action,
            submissionId: input.submissionId,
            boundOption: input.boundOption || null,
          }),
        },
      );
    } catch (error) {
      throw new ServiceUnavailableException({
        code: "OPENOVEL_RUNTIME_UNAVAILABLE",
        message: "The OpenNovel runtime could not be reached for reconciliation.",
        cause: String((error as Error)?.message || error),
      });
    }

    const text = await response.text();
    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text };
    }
    if (!response.ok) {
      const runtimeCode = String(payload?.error || payload?.code || "OPENOVEL_RUNTIME_REPLAY_FAILED");
      throw new HttpException({
        code: runtimeCode,
        message: String(payload?.message || runtimeCode),
        runtimeStatus: response.status,
      }, response.status);
    }
    return payload;
  }
}
