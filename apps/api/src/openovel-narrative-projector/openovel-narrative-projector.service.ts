import { Inject, Injectable } from "@nestjs/common";
import type { StoryTaskLeaseFenceV1 } from "../story-task-outbox.contract";
import { NarrativeContextCompiler } from "./narrative-context-compiler";
import { NarrativeFallbackRenderer } from "./narrative-fallback-renderer";
import { NarrativePublisher } from "./narrative-publisher";
import { NarrativeRenderer } from "./narrative-renderer";
import { NarrativeSourceReader } from "./narrative-source-reader";
import { NarrativeTruthGuard } from "./narrative-truth-guard";
import type { NarrativePublicationResultV1 } from "./openovel-narrative-projector.contract";

/**
 * External narrative projection boundary. This service owns no authoritative
 * repository or committer port: it reads an immutable source commit and may
 * write only NarrativeEntry plus the leased narrative task metadata.
 */
@Injectable()
export class OpenNovelNarrativeProjector {
  constructor(
    @Inject(NarrativeSourceReader) private readonly sourceReader: NarrativeSourceReader,
    @Inject(NarrativeContextCompiler) private readonly contextCompiler: NarrativeContextCompiler,
    @Inject(NarrativeRenderer) private readonly renderer: NarrativeRenderer,
    @Inject(NarrativeTruthGuard) private readonly truthGuard: NarrativeTruthGuard,
    @Inject(NarrativeFallbackRenderer) private readonly fallbackRenderer: NarrativeFallbackRenderer,
    @Inject(NarrativePublisher) private readonly publisher: NarrativePublisher,
  ) {}

  async projectTask(taskId: string, fence: StoryTaskLeaseFenceV1): Promise<NarrativePublicationResultV1> {
    const source = await this.sourceReader.read(taskId, fence);
    const context = this.contextCompiler.compile(source);
    await this.publisher.markStatus({
      taskId,
      leaseOwner: fence.leaseOwner,
      leaseVersion: fence.leaseVersion,
      status: "GENERATING",
    });
    let content: string;
    let failureCode: string | null = null;
    let model: string | null = null;
    let providerRequestId: string | null = null;
    let narrativeStatus: "PUBLISHED" | "FALLBACK_PUBLISHED" = "PUBLISHED";
    try {
      const rendered = await this.renderer.render(context);
      model = rendered.model;
      providerRequestId = rendered.providerRequestId;
      await this.publisher.markStatus({
        taskId,
        leaseOwner: fence.leaseOwner,
        leaseVersion: fence.leaseVersion,
        status: "VALIDATING",
      });
      const guarded = this.truthGuard.validate(rendered.text, context);
      if (!guarded.ok) {
        failureCode = guarded.failureCode || "NARRATIVE_TRUTH_GUARD_REJECTED";
        narrativeStatus = "FALLBACK_PUBLISHED";
        content = this.fallbackRenderer.render(context);
      } else {
        content = guarded.normalizedText;
      }
    } catch (error) {
      failureCode = classifyFailure(error);
      narrativeStatus = "FALLBACK_PUBLISHED";
      content = this.fallbackRenderer.render(context);
    }
    return this.publisher.publish({
      taskId,
      leaseOwner: fence.leaseOwner,
      leaseVersion: fence.leaseVersion,
      source,
      content,
      narrativeStatus,
      failureCode,
      model,
      providerRequestId,
    });
  }
}

function classifyFailure(error: unknown): string {
  const message = String((error as Error)?.message || error || "").toUpperCase();
  if (!message.trim()) return "NARRATIVE_RENDERER_FAILED";
  if (/TIMEOUT|TIMED OUT/.test(message)) return "NARRATIVE_RENDERER_TIMEOUT";
  if (/500|HTTP/.test(message)) return "NARRATIVE_RENDERER_HTTP_ERROR";
  if (/EMPTY/.test(message)) return "NARRATIVE_RENDERER_EMPTY";
  return message.replace(/[^A-Z0-9_]+/g, "_").slice(0, 96) || "NARRATIVE_RENDERER_FAILED";
}
