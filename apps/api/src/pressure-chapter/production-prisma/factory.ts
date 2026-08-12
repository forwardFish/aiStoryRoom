import type { PrismaService } from "../../prisma.service";
import type { RuntimeChapterHandoffStartPortV1 } from "../runtime/contracts";
import {
  PrismaGenesisOpenN1HandoffConsumerAdapter,
  type GenesisOpenN1HandoffConsumerOptionsV1,
} from "./genesis-open-n1-handoff.prisma-adapter";
import { PrismaPressureLobbyPersistenceAdapter } from "./lobby.prisma-adapter";
import type {
  GenesisOpenN1HandoffPrismaClient,
  GenesisOpenN1HandoffTransaction,
  PressureProductionPrismaClient,
  PressureProductionTransaction,
} from "./prisma-ports";
import { PrismaPressureRunShellWriterAdapter } from "./run-shell.prisma-adapter";
import { PrismaPressureStartBoundaryAdapter } from "./start-boundary.prisma-adapter";

/**
 * Nest composition helper. The N1 starter is deliberately a separate required
 * dependency: it is the sole capability allowed to open N1.
 */
export function createPrismaPressureProductionAdaptersV1(
  prisma: PrismaService,
  n1Starter: RuntimeChapterHandoffStartPortV1,
  n1Options: Partial<GenesisOpenN1HandoffConsumerOptionsV1> = {},
) {
  const productionPrisma = projectPressureProductionPrismaV1(prisma);
  const handoffPrisma = projectGenesisN1HandoffPrismaV1(prisma);
  return {
    runShellWriter: new PrismaPressureRunShellWriterAdapter(productionPrisma),
    lobbyPersistence: new PrismaPressureLobbyPersistenceAdapter(productionPrisma),
    startBoundary: new PrismaPressureStartBoundaryAdapter(productionPrisma),
    genesisN1Handoff: new PrismaGenesisOpenN1HandoffConsumerAdapter(
      handoffPrisma,
      n1Starter,
      n1Options,
    ),
  } as const;
}

export function projectPressureProductionPrismaV1(
  prisma: PrismaService,
): PressureProductionPrismaClient {
  return {
    $transaction: (operation, options) =>
      prisma.$transaction(
        (tx) =>
          operation(Object.freeze({
            storyRun: tx.storyRun,
            storyRole: tx.storyRole,
            storyPlayer: tx.storyPlayer,
            pressureRunLifecycle: tx.pressureRunLifecycle,
          }) as unknown as PressureProductionTransaction),
        options,
      ),
  };
}

export function projectGenesisN1HandoffPrismaV1(
  prisma: PrismaService,
): GenesisOpenN1HandoffPrismaClient {
  return {
    $transaction: (operation, options) =>
      prisma.$transaction(
        (tx) =>
          operation(Object.freeze({
            pressureOutboxTask: tx.pressureOutboxTask,
          }) as unknown as GenesisOpenN1HandoffTransaction),
        options,
      ),
  };
}
