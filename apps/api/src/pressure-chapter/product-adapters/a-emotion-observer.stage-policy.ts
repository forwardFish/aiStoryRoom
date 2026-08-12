import type { SeatIdV1 } from "@ai-story/shared";
import { loadPublishedSangtianAEmotionPolicyV1 } from "@ai-story/templates";
import type { AEmotionObserverResolverPortV1 } from "../a-emotion";
import {
  PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1 as ERROR,
  failPressureProductAdapterV1,
} from "./errors";

const PUBLISHED_AUDIENCE_MODES_V1 = Object.freeze([
  "ACTION_BINDING_TARGETS",
  "SOURCE_SEAT_ONLY",
] as const);

/**
 * The published Sangtian policy never emits an OBSERVERS audience.  This port
 * exists only because the generic projector contract supports that future
 * extension.  Reaching it under this release is authority drift and must fail
 * closed; an empty audience would silently hide a malformed committed event.
 */
export class FailClosedSangtianAEmotionObserverResolverV1
implements AEmotionObserverResolverPortV1 {
  readonly policySha256: string;

  constructor() {
    const release = loadPublishedSangtianAEmotionPolicyV1();
    const templates = [
      release.policy.beat.template,
      ...release.policy.chapter.templates.map((entry) => entry.template),
      ...release.policy.finale.templates.map((entry) => entry.template),
    ];
    if (templates.some((template) => (
      !PUBLISHED_AUDIENCE_MODES_V1.includes(template.audienceMode)
    ))) {
      failPressureProductAdapterV1(
        ERROR.AUTHORITY_MISMATCH,
        "aEmotion.policy.audienceMode",
        "UNPUBLISHED_MODE",
      );
    }
    this.policySha256 = release.artifactSha256;
  }

  async resolve(_input: {
    roomId: string;
    runId: string;
    resolverCode: string;
    contextRefs: string[];
  }): Promise<SeatIdV1[]> {
    return failPressureProductAdapterV1(
      ERROR.UNSUPPORTED_STAGE,
      "aEmotionObserverResolver.resolve",
      "OBSERVERS_NOT_PUBLISHED",
    );
  }
}
