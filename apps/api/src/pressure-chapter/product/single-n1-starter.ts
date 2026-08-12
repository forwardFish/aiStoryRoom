import type {
  RuntimeChapterHandoffStartPortV1,
  RuntimeGenesisN1HandoffPortV1,
} from "../runtime/contracts";
import {
  PRESSURE_CHAPTER_PRODUCT_ERROR_CODES as ERROR,
  failPressureChapterProduct,
} from "./errors";

/**
 * Captures the one orchestrator instance created by runtime composition and
 * binds exactly one durable Genesis OPEN_CHAPTER consumer to it. Production
 * startup cannot accidentally construct a second N1 starter.
 */
export class PressureSingleN1StarterBinderV1 {
  private starter: RuntimeChapterHandoffStartPortV1 | null = null;
  private handoff: RuntimeGenesisN1HandoffPortV1 | null = null;

  bind(
    starter: RuntimeChapterHandoffStartPortV1,
    create: (
      starter: RuntimeChapterHandoffStartPortV1,
    ) => RuntimeGenesisN1HandoffPortV1,
  ): RuntimeGenesisN1HandoffPortV1 {
    if (this.starter !== null && this.starter !== starter) {
      return failPressureChapterProduct(
        ERROR.N1_STARTER_CONFLICT,
        "runtime.chapterStarter",
      );
    }
    if (this.handoff !== null) return this.handoff;
    const handoff = create(starter);
    if (!handoff || typeof handoff.openFromGenesisHandoff !== "function") {
      return failPressureChapterProduct(
        ERROR.PRODUCTION_PORT_INVALID,
        "runtime.genesisN1Handoff.openFromGenesisHandoff",
      );
    }
    this.starter = starter;
    this.handoff = handoff;
    return handoff;
  }

  requireBound(): RuntimeGenesisN1HandoffPortV1 {
    if (!this.handoff) {
      return failPressureChapterProduct(
        ERROR.COMPOSITION_INCOMPLETE,
        "runtime.genesisN1Handoff",
      );
    }
    return this.handoff;
  }

  isBoundTo(starter: RuntimeChapterHandoffStartPortV1): boolean {
    return this.starter === starter && this.handoff !== null;
  }
}
