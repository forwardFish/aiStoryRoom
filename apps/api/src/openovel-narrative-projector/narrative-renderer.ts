import { Inject, Injectable } from "@nestjs/common";
import { OpenNovelRuntimeClient } from "../openovel-adapter/openovel-runtime.client";
import type { CompiledNarrativeContextV1 } from "./narrative-context-compiler";
import type { NarrativeRenderOutputV1 } from "./openovel-narrative-projector.contract";

@Injectable()
export class NarrativeRenderer {
  constructor(@Inject(OpenNovelRuntimeClient) private readonly runtime: OpenNovelRuntimeClient) {}

  async render(context: CompiledNarrativeContextV1): Promise<NarrativeRenderOutputV1> {
    const response = await this.runtime.generateB0Narrative(context.providerInput);
    const publication = record(response?.publication ?? response);
    const text = String(publication?.prose ?? "").trim();
    if (!text) throw new Error("NARRATIVE_RENDERER_EMPTY_TEXT");
    return {
      text,
      model: optionalText(response?.model ?? publication?.model),
      providerRequestId: optionalText(response?.providerRequestId ?? publication?.providerRequestId),
    };
  }
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function optionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}
