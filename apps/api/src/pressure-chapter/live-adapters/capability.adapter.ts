import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  PressureGameCapabilitiesV1,
  PressureGameCapabilityReaderPort,
} from "../game-projection/contracts";
import type { CanonicalSeatViewerAuthorityReaderPortV1 } from "./viewer-authority.adapter";
import {
  PRESSURE_LIVE_ADAPTER_ERROR_CODES as ERROR,
  failLiveAdapter,
} from "./errors";

interface ChapterRuntimeCapabilityRowV1 {
  id: string;
  runId: string;
  routeHash: string;
  state: string;
  workingRevision: number;
  decisionStateJson: unknown;
}

export interface PressureCapabilityReadPrismaLikeV1 {
  pressureChapterRuntime: {
    findUnique(input: {
      where: { id: string };
      select: {
        id: true;
        runId: true;
        routeHash: true;
        state: true;
        workingRevision: true;
        decisionStateJson: true;
      };
    }): Promise<ChapterRuntimeCapabilityRowV1 | null>;
  };
}

/**
 * Capability policy is the intersection of canonical viewer control and the
 * exact decision envelope embedded in the chapter runtime. Workbench rights remain false because no
 * frozen per-run workbench policy exists in the current schema.
 */
export class PrismaPressureGameCapabilityReaderV1
implements PressureGameCapabilityReaderPort {
  constructor(
    private readonly prisma: PressureCapabilityReadPrismaLikeV1,
    private readonly viewers: CanonicalSeatViewerAuthorityReaderPortV1,
  ) {}

  async readCapabilities(input: {
    runId: string;
    routeHash: string;
    subjectId: string;
    viewerSeatId: SeatIdV1;
    chapterRuntimeId: string;
    decisionPointId: string | null;
  }): Promise<PressureGameCapabilitiesV1> {
    const [viewer, runtime] = await Promise.all([
      this.viewers.read({
        runId: input.runId,
        subjectId: input.subjectId,
      }),
      this.prisma.pressureChapterRuntime.findUnique({
        where: { id: input.chapterRuntimeId },
        select: {
          id: true,
          runId: true,
          routeHash: true,
          state: true,
          workingRevision: true,
          decisionStateJson: true,
        },
      }),
    ]);
    if (!runtime) {
      return failLiveAdapter(
        ERROR.AUTHORITY_NOT_FOUND,
        "PressureChapterRuntime",
        input.chapterRuntimeId,
      );
    }
    if (!viewer) {
      return failLiveAdapter(ERROR.SUBJECT_FORBIDDEN, "StoryPlayer", input.subjectId);
    }
    if (
      runtime.id !== input.chapterRuntimeId
      || runtime.runId !== input.runId
      || runtime.routeHash !== input.routeHash
      || viewer.routeHash !== input.routeHash
      || viewer.seatId !== input.viewerSeatId
      || viewer.subjectId !== input.subjectId
    ) {
      return failLiveAdapter(ERROR.AUTHORITY_MISMATCH, "PressureChapterRuntime", "SCOPE");
    }

    let requiredForViewer = false;
    let pointOpen = false;
    let allowedActionTypes: string[] = [];
    if (input.decisionPointId !== null) {
      const point = decisionState(runtime.decisionStateJson, runtime.workingRevision);
      if (!point || point.decisionPointId !== input.decisionPointId) {
        return failLiveAdapter(
          ERROR.AUTHORITY_NOT_FOUND,
          "PressureChapterRuntime.decisionStateJson",
          input.decisionPointId,
        );
      }
      const requiredSeats = point.requiredSeatIds;
      allowedActionTypes = point.allowedActionTypes;
      requiredForViewer = requiredSeats.includes(input.viewerSeatId);
      pointOpen = true;
    }
    const runtimeAcceptsDraft = runtime.state === "DECISION_POINT_OPEN"
      || runtime.state === "ACTION_DRAFTING";
    return {
      canSubmitDecision: Boolean(
        input.decisionPointId
        && viewer.control.canSubmit
        && requiredForViewer
        && pointOpen
        && runtimeAcceptsDraft
      ),
      canTalk: false,
      canInvestigate: false,
      canUseToken: false,
      canPlan: false,
      canReclaimControl: viewer.control.canReclaim,
      allowedActionTypes,
    };
  }
}

function decisionState(value: unknown, runtimeWorkingRevision: number): {
  decisionPointId: string;
  requiredSeatIds: SeatIdV1[];
  allowedActionTypes: string[];
} | null {
  if (!value || typeof value !== "object") invalid("decisionStateJson", "OBJECT");
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== "pressure_mvp_decision_state_v1"
    || !Number.isSafeInteger(record.workingRevision)
    || record.workingRevision !== runtimeWorkingRevision
  ) invalid("decisionStateJson", "SCHEMA_OR_REVISION");
  if (record.state === "NONE" && record.activeDecisionPointId === null) return null;
  if (
    record.state !== "OPEN"
    || typeof record.activeDecisionPointId !== "string"
    || !record.activeDecisionPointId.trim()
  ) invalid("decisionStateJson", "ACTIVE_DECISION");
  return {
    decisionPointId: record.activeDecisionPointId,
    requiredSeatIds: seatIds(record.requiredSeatIds),
    allowedActionTypes: actionTypes(record.allowedActionTypes),
  };
}

function seatIds(value: unknown): SeatIdV1[] {
  if (!Array.isArray(value)) invalid("requiredSeatIdsJson", "ARRAY");
  const result = value.map((entry) => {
    if (
      typeof entry !== "string"
      || !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(entry as SeatIdV1)
    ) {
      invalid("requiredSeatIdsJson", "CANONICAL_SEAT_IDS");
    }
    return entry as SeatIdV1;
  });
  if (new Set(result).size !== result.length) invalid("requiredSeatIdsJson", "UNIQUE");
  return result;
}

function actionTypes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) invalid("allowedActionTypesJson", "ARRAY_MAX_30");
  const result = value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      return invalid("allowedActionTypesJson", "NON_EMPTY_STRING_ITEMS");
    }
    return entry;
  });
  if (new Set(result).size !== result.length) invalid("allowedActionTypesJson", "UNIQUE");
  return result.sort(compareCanonicalText);
}

function invalid(field: string, detail: string): never {
  return failLiveAdapter(ERROR.RECORD_INVALID, `PressureChapterRuntime.${field}`, detail);
}
