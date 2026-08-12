import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type {
  PressureWorkerRuntimeControllerV1,
  PressureWorkerRuntimeHealthV1,
} from "../worker-runtime";
import type { PressureChapterWorkerOwnershipSnapshotV1 } from "./contracts";

/**
 * The sole Nest lifecycle owner for every Pressure post-commit worker lane.
 *
 * The underlying runtime is deliberately not registered as a second Nest
 * provider, so Nest cannot call its hooks in parallel with this coordinator.
 */
export class PressureChapterWorkerLifecycleV1
implements OnModuleInit, OnModuleDestroy {
  private started = false;
  private stopped = false;
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;

  constructor(
    private readonly supervisor: PressureWorkerRuntimeControllerV1,
    private readonly workerOwnership: PressureChapterWorkerOwnershipSnapshotV1 = {
      schemaVersion: "pressure_chapter_worker_ownership_v1",
      processRole: "api",
      configuredOwner: "embedded_api",
      configuredOwnerExplicit: false,
      topology: "embedded",
      ownsWorkerLanes: true,
      ready: true,
    },
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.workerOwnership.ready || !this.workerOwnership.ownsWorkerLanes) {
      return;
    }
    if (this.started) return;
    if (this.stopped) {
      throw new Error("Pressure worker lifecycle cannot restart after destroy");
    }
    if (!this.starting) {
      this.starting = this.supervisor.start().then(() => {
        this.started = true;
      }).finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.workerOwnership.ready || !this.workerOwnership.ownsWorkerLanes) {
      return;
    }
    if (this.stopped) return;
    if (!this.stopping) {
      this.stopping = (async () => {
        if (this.starting) await this.starting;
        await this.supervisor.stop();
        this.stopped = true;
      })().finally(() => {
        this.stopping = null;
      });
    }
    await this.stopping;
  }

  health(): PressureWorkerRuntimeHealthV1 {
    return this.supervisor.health();
  }

  ownership(): PressureChapterWorkerOwnershipSnapshotV1 {
    return { ...this.workerOwnership };
  }
}
