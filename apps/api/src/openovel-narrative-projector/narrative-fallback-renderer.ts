import { Injectable } from "@nestjs/common";
import { NARRATIVE_PENDING_MESSAGE_ZH } from "@ai-story/shared";
import type { CompiledNarrativeContextV1 } from "./narrative-context-compiler";

@Injectable()
export class NarrativeFallbackRenderer {
  render(context: CompiledNarrativeContextV1): string {
    const lines = [...new Set(context.fallbackLines.map((line) => String(line || "").trim()).filter(Boolean))];
    return lines.length ? lines.join("\n\n") : NARRATIVE_PENDING_MESSAGE_ZH;
  }
}
