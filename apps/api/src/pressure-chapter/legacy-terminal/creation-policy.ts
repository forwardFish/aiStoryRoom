import type {
  LegacyCreationPolicyResolutionV1,
  LegacyT20CreationIntentV1,
} from "./contracts";
import {
  LEGACY_TERMINAL_ERROR_CODES as ERROR,
  failLegacyTerminal,
} from "./errors";
import type { LegacyT20CreationPolicyGuardPortV1 } from "./ports";

/** Frozen default: old T20 creation and SAME replay are permanently closed. */
export class ClosedLegacyT20CreationPolicyGuardV1 implements LegacyT20CreationPolicyGuardPortV1 {
  resolve(intent: LegacyT20CreationIntentV1): LegacyCreationPolicyResolutionV1 {
    if (intent === "START_LATEST_EXPERIENCE") {
      return {
        intent,
        allowed: true,
        targetRuntimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
        reason: null,
      };
    }
    if (intent === "RESTART_SAME_EXPERIENCE") {
      failLegacyTerminal(ERROR.SAME_EXPERIENCE_DISABLED, intent);
    }
    failLegacyTerminal(ERROR.CREATION_DISABLED, intent);
  }
}

export class LegacyT20CreationPolicyServiceV1 {
  constructor(private readonly guard: LegacyT20CreationPolicyGuardPortV1) {}

  resolve(intent: LegacyT20CreationIntentV1): LegacyCreationPolicyResolutionV1 {
    return this.guard.resolve(intent);
  }
}

