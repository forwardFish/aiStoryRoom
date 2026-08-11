export const AUTHORITATIVE_RESULT_STATUS_FINALIZED = "FINALIZED" as const;

export const NARRATIVE_PROJECTION_STATUSES = [
  "PENDING",
  "GENERATING",
  "VALIDATING",
  "PUBLISHED",
  "FALLBACK_PUBLISHED",
  "FAILED_RETRYABLE",
] as const;

export type AuthoritativeResultStatus = typeof AUTHORITATIVE_RESULT_STATUS_FINALIZED;
export type NarrativeProjectionStatus = typeof NARRATIVE_PROJECTION_STATUSES[number];

export const NARRATIVE_PENDING_MESSAGE_ZH = "权威结局已确认，故事化结局正在生成。" as const;
export const NARRATIVE_PENDING_MESSAGE_EN = "The authoritative result is final. Its story presentation is being generated." as const;

export type NarrativeProjectionSummaryV1 = Readonly<{
  schemaVersion: "openovel-narrative-projection-v1";
  authoritativeResultStatus: AuthoritativeResultStatus;
  structuredResultReady: true;
  narrativeStatus: NarrativeProjectionStatus;
  sourceCommitHash: string;
  presentationHash: string | null;
  content: string | null;
  updatedAt: string | null;
}>;

export function isNarrativeProjectionStatus(value: unknown): value is NarrativeProjectionStatus {
  return typeof value === "string"
    && (NARRATIVE_PROJECTION_STATUSES as readonly string[]).includes(value);
}
