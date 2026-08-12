import type { PrismaService } from "../../prisma.service";
import { PrismaProgressOutboxRepositoryV1, type ProgressOutboxPrismaClientV1 } from "./prisma-adapter";
import { PressureProgressOutboxWorkerV1 } from "./progress-outbox.service";
import type {
  ProgressOutboxClockPortV1,
  ProgressOutboxWorkerConfigV1,
  RuntimeProgressFinalePortV1,
  RuntimeProgressOpenChapterPortV1,
} from "./ports";

const DEFAULT_CONFIG: ProgressOutboxWorkerConfigV1 = Object.freeze({
  leaseMs: 30_000,
  baseRetryMs: 5_000,
  maxRetryMs: 60_000,
});

export function createPrismaPressureProgressOutboxWorkerV1(
  prisma: PrismaService,
  dependencies: {
    clock: ProgressOutboxClockPortV1;
    openNextChapter: RuntimeProgressOpenChapterPortV1;
    finale: RuntimeProgressFinalePortV1;
  },
  config: Partial<ProgressOutboxWorkerConfigV1> = {},
) {
  const outbox = new PrismaProgressOutboxRepositoryV1(
    projectPressureProgressOutboxPrismaV1(prisma),
  );
  const worker = new PressureProgressOutboxWorkerV1(
    outbox,
    dependencies.openNextChapter,
    dependencies.finale,
    dependencies.clock,
    { ...DEFAULT_CONFIG, ...config },
  );
  return { outbox, worker } as const;
}

export function projectPressureProgressOutboxPrismaV1(
  prisma: PrismaService,
): ProgressOutboxPrismaClientV1 {
  return {
    $transaction: (operation, options) =>
      prisma.$transaction(
        (tx) =>
          operation(Object.freeze({
            pressureOutboxTask: tx.pressureOutboxTask,
          }) as unknown as Parameters<typeof operation>[0]),
        options,
      ),
  };
}
