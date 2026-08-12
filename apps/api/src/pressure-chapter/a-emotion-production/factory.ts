import { AEmotionPostCommitConsumerV1 } from "./consumer";
import type {
  AEmotionPostCommitProductionDependenciesV1,
  AEmotionPostCommitWorkerPortV1,
} from "./contracts";

export interface AEmotionPostCommitProductionV1 {
  /** Capability intended for ProductRoot or a supervised worker runner. */
  readonly worker: AEmotionPostCommitWorkerPortV1;
}

/**
 * Composes the application worker without selecting infrastructure adapters.
 * Concrete Prisma/outbox bindings belong at ProductRoot's composition edge.
 */
export function createAEmotionPostCommitProductionV1(
  dependencies: Readonly<AEmotionPostCommitProductionDependenciesV1>,
): AEmotionPostCommitProductionV1 {
  const worker = new AEmotionPostCommitConsumerV1(
    dependencies.outbox,
    dependencies.authority,
    dependencies.viewers,
    dependencies.pipeline,
    dependencies.clock,
    dependencies.config,
  );
  return Object.freeze({ worker });
}
