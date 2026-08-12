import {
  loadPublishedSangtianAiDecisionPolicyV1,
  type PublishedSangtianAiDecisionPolicyV1,
} from "@ai-story/templates";
import type {
  AiDecisionPolicyInputV1,
  AiDecisionPolicySelectionV1,
  ContentOwnedAiDecisionPolicyPortV1,
} from "./contracts";

/**
 * The only API-side bridge to the published AI decision policy. Loading,
 * artifact/hash validation, binding checks, deterministic ranking and output
 * hashing remain wholly owned by @ai-story/templates. This adapter loads once
 * and performs no algorithmic translation or fallback.
 */
export class PublishedSangtianAiDecisionPolicyAdapterV1
implements ContentOwnedAiDecisionPolicyPortV1 {
  private readonly published: PublishedSangtianAiDecisionPolicyV1;

  constructor(
    options: Readonly<{ releaseRoot?: string }> = {},
  ) {
    this.published = loadPublishedSangtianAiDecisionPolicyV1(options);
  }

  get artifactSha256(): string {
    return this.published.artifactSha256;
  }

  select(
    input: Readonly<AiDecisionPolicyInputV1>,
  ): AiDecisionPolicySelectionV1 {
    return this.published.select(input);
  }
}
