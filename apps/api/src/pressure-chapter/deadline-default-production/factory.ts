import type { PressureDeadlineDefaultProductionDependenciesV1 } from "./contracts";
import { createPrismaPressureSeatDecisionProofWriterV1 } from "./prisma-proof-writer";
import { PressureDeadlineDefaultProductionServiceV1 } from "./service";

export interface PressureDeadlineDefaultProductionInputV1
extends Omit<PressureDeadlineDefaultProductionDependenciesV1, "proofs"> {
  prisma: unknown;
}

export function createPressureDeadlineDefaultProductionV1(
  input: PressureDeadlineDefaultProductionInputV1,
): PressureDeadlineDefaultProductionServiceV1 {
  return new PressureDeadlineDefaultProductionServiceV1({
    orchestrators: input.orchestrators,
    working: input.working,
    content: input.content,
    seats: input.seats,
    seatControl: input.seatControl,
    proofs: createPrismaPressureSeatDecisionProofWriterV1(input.prisma),
    runtime: input.runtime,
  });
}
