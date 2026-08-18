import { isSha256, type SeatIdV1 } from "@ai-story/shared";
import type {
  PressureNarrativePublishedEventV1,
  PressureSeatTransportNarrativePortV1,
} from "./contracts";

interface NarrativeDeliveryRowV1 {
  runId: string;
  type: string;
  roleKey: string | null;
  sequence: number | null;
  payloadJson: unknown;
}

export interface PressureNarrativeDeliveryPrismaClientV1 {
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<NarrativeDeliveryRowV1[]>;
    findFirst(input: Record<string, unknown>): Promise<NarrativeDeliveryRowV1 | null>;
  };
}

export class PrismaPressureNarrativeDeliveryReaderV1
implements PressureSeatTransportNarrativePortV1 {
  constructor(private readonly prisma: PressureNarrativeDeliveryPrismaClientV1) {}

  async listAfterSequence(input: Readonly<{
    runId: string;
    viewerSeatId: SeatIdV1;
    afterSequence: number;
    limit: number;
  }>) {
    if (
      !input.runId.trim()
      || !Number.isSafeInteger(input.afterSequence)
      || input.afterSequence < 0
      || !Number.isSafeInteger(input.limit)
      || input.limit < 1
      || input.limit > 50
    ) throw new Error("PRESSURE_NARRATIVE_DELIVERY_INPUT_INVALID");
    const [rows, newest] = await Promise.all([
      this.prisma.storyEvent.findMany({
        where: {
          runId: input.runId,
          type: "PRESSURE_NARRATIVE_PUBLISHED_EVENT",
          sequence: { gt: input.afterSequence },
          OR: [{ roleKey: null }, { roleKey: input.viewerSeatId }],
        },
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        take: input.limit + 1,
        select: { runId: true, type: true, roleKey: true, sequence: true, payloadJson: true },
      }),
      this.prisma.storyEvent.findFirst({
        where: { runId: input.runId, type: "PRESSURE_NARRATIVE_PUBLISHED_EVENT" },
        orderBy: [{ sequence: "desc" }, { id: "desc" }],
        select: { runId: true, type: true, roleKey: true, sequence: true, payloadJson: true },
      }),
    ]);
    const hasMore = rows.length > input.limit;
    const visible = rows.slice(0, input.limit).map((row) => decode(row, input));
    const nextAfterSequence = visible.at(-1)?.deliverySequence ?? input.afterSequence;
    return Object.freeze({
      events: visible,
      nextAfterSequence,
      currentServerSequence: newest?.sequence ?? nextAfterSequence,
      hasMore,
    });
  }
}

function decode(
  row: NarrativeDeliveryRowV1,
  scope: { runId: string; viewerSeatId: SeatIdV1 },
): PressureNarrativePublishedEventV1 {
  const value = structuredClone(row.payloadJson) as PressureNarrativePublishedEventV1;
  if (
    row.runId !== scope.runId
    || row.type !== "PRESSURE_NARRATIVE_PUBLISHED_EVENT"
    || !Number.isSafeInteger(row.sequence)
    || value.schemaVersion !== "pressure_narrative_published_event_v1"
    || value.runId !== scope.runId
    || value.viewerSeatId !== scope.viewerSeatId
    || value.deliverySequence !== row.sequence
    || !isSha256(value.routeHash)
    || !isSha256(value.identityHash)
    || value.narrative.sourceId !== value.sourceId
    || value.narrative.projectionKind !== value.projectionKind
    || value.narrative.status !== value.status
    || (row.roleKey !== null && row.roleKey !== scope.viewerSeatId)
  ) throw new Error("PRESSURE_NARRATIVE_DELIVERY_SCOPE_MISMATCH");
  return value;
}
