import { openingKey } from "./foreground.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type {
  ModelMessage,
  OpenNovelProvider,
  ProviderResult,
  TurnEvent,
} from "./types.js";

export type NarrativeRendererInput = {
  runId: string;
  turnId: string;
  messages: ModelMessage[];

  previousOpening: string;
  onEvent?: (event: TurnEvent) => void;
};

/** Narrator owns literary expression only; it cannot mutate world state. */
export interface NarrativeRendererModule {
  readonly moduleId: string;
  render(input: NarrativeRendererInput): Promise<ProviderResult>;
}

export class ProviderNarrativeRenderer implements NarrativeRendererModule {
  readonly moduleId = "openovel.provider-narrative-renderer.v1";

  constructor(
    private readonly provider: OpenNovelProvider,
    private readonly workspace: FileStoryWorkspace,
  ) {}

  async render(input: NarrativeRendererInput): Promise<ProviderResult> {

    const stream = new RepeatAwareStream(input.previousOpening, (text) => {
      input.onEvent?.({ type: "narration.delta", data: { text } });
    });
    const request = {
      profile: "narrator" as const,
      messages: input.messages,
      temperature: narratorTemperature(),
      maxTokens: narratorMaxTokens(),
      json: false,
      stream: true,
      onDelta: (text: string) => stream.push(text),
    };
    let generatedResult: ProviderResult | undefined;
    try {
      const result = await this.provider.generate(request);
      generatedResult = result;
      stream.finish(result.text);
      if (result.finishReason === "length") throw new Error("MODEL_OUTPUT_TRUNCATED");
      await this.workspace.recordModelCall(
        input.runId,
        input.turnId,
        "narrator",
        request,
        result,
      ).catch(() => {});
      return result;
    } catch (error) {
      await this.workspace.recordModelCall(
        input.runId,
        input.turnId,
        "narrator",
        request,
        generatedResult,
        error,
      ).catch(() => {});
      throw error;
    }
  }
}

function narratorMaxTokens() {
  const configured = Number(process.env.OPENOVEL_NARRATOR_MAX_TOKENS || 4_000);
  if (!Number.isFinite(configured)) return 4_000;
  return Math.min(8_000, Math.max(2_000, Math.trunc(configured)));
}

function narratorTemperature() {
  const configured = Number(process.env.OPENOVEL_NARRATOR_TEMPERATURE || 0.86);
  return Number.isFinite(configured)
    ? Math.max(0.2, Math.min(1.2, configured))
    : 0.86;
}

class RepeatAwareStream {
  private buffer = "";
  private decided = false;
  private repeated = false;

  constructor(
    private readonly previousOpening: string,
    private readonly forward: (text: string) => void,
  ) {}

  push(text: string) {
    if (this.decided) {
      if (!this.repeated) this.forward(text);
      return;
    }
    this.buffer += text;
    const current = openingKey(this.buffer);
    if (!this.previousOpening) {
      this.decide(false);
      return;
    }
    if (!this.previousOpening.startsWith(current)) {
      this.decide(false);
      return;
    }
    if (current.length >= this.previousOpening.length) this.decide(true);
  }

  finish(fullText: string) {
    if (!this.decided) {
      const repeated = Boolean(this.previousOpening)
        && openingKey(fullText) === this.previousOpening;
      this.decide(repeated);
    }
    return this.repeated;
  }

  private decide(repeated: boolean) {
    this.decided = true;
    this.repeated = repeated;
    if (!repeated && this.buffer) this.forward(this.buffer);
    this.buffer = "";
  }
}
