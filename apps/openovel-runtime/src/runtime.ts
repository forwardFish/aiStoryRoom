/*
 * Turn ordering and failure behavior are derived from Feed-Scription/openovel:
 * src/runtime/sessionProcessor.js and src/lib/narrator.js.
 * Licensed under Apache-2.0. Modified for Our Many Worlds on 2026-07-27.
 */
import {
  activateContextCards,
  buildNarratorMessages,
  buildOptionsMessages,
  compileForegroundContext,
  openingKey,
  previousNarrationOpening,
} from "./foreground.js";
import { parseOptions } from "./options.js";
import { shadowContinuityWarnings, validateForegroundSurface } from "./surface-guard.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type {
  BoundOption,
  EventMirror,
  OpenNovelOption,
  OpenNovelProvider,
  RuntimeWarning,
  TurnEvent,
  TurnResult,
} from "./types.js";

export class OpenNovelRuntime {
  private readonly foregroundLocks = new Set<string>();

  constructor(
    private readonly workspace: FileStoryWorkspace,
    private readonly provider: OpenNovelProvider,
    private readonly storykeeper: { kick(runId: string): Promise<void> | void },
    private readonly mirror: EventMirror,
  ) {}

  async createRun(input: {
    runId: string;
    worldId: string;
    roleId: string;
    storyPackageVersion?: string;
    openingVersion?: string;
  }) {
    const run = await this.workspace.createRun(input);
    await this.mirror.publish({ kind: "run.created", runId: input.runId, payload: run }).catch(() => {});
    this.storykeeper.kick(input.runId);
    return run;
  }

  async getRun(runId: string) {
    return this.workspace.readPublicRun(runId);
  }

  async processAction(input: {
    runId: string;
    action: string;
    boundOption?: BoundOption | null;
    onEvent?: (event: TurnEvent) => void;
  }): Promise<TurnResult> {
    const action = String(input.action || "").trim();
    if (!action) throw new Error("action is required");
    if (action.length > 2_000) throw new Error("action is too long");
    if (this.foregroundLocks.has(input.runId)) {
      throw new Error("RUN_FOREGROUND_BUSY");
    }
    this.foregroundLocks.add(input.runId);
    try {
      return await this.runTurn({ ...input, action });
    } catch (error) {
      const message = String((error as Error).message || error);
      await this.workspace.updateMetadata(input.runId, {
        status: "FAILED",
        lastError: message.slice(0, 1_000),
      }).catch(() => {});
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_failed",
        turnId: `T${String((await this.workspace.metadata(input.runId).catch(() => ({ turnNumber: 0 }))).turnNumber + 1).padStart(2, "0")}`,
        action,
        error: message.slice(0, 1_000),
      }).catch(() => {});
      throw error;
    } finally {
      this.foregroundLocks.delete(input.runId);
    }
  }

  isBusy(runId: string) {
    return this.foregroundLocks.has(runId);
  }

  private async runTurn(input: {
    runId: string;
    action: string;
    boundOption?: BoundOption | null;
    onEvent?: (event: TurnEvent) => void;
  }) {
    const snapshot = await this.workspace.snapshot(input.runId);
    const turnNumber = snapshot.metadata.turnNumber + 1;
    const turnId = `T${String(turnNumber).padStart(2, "0")}`;
    const selectedOption = resolveBoundOption(
      input.boundOption || null,
      snapshot.previousOptions,
      input.action,
    );
    await this.workspace.updateMetadata(input.runId, {
      status: "FOREGROUND_RUNNING",
      lastError: undefined,
    });
    await this.workspace.recordSceneEvent(input.runId, {
      type: "reader_action",
      turnId,
      action: input.action,
      source: selectedOption ? "option" : "free-text",
      selectedOption,
    });

    const paths = this.workspace.paths(input.runId);
    await activateContextCards(paths, input.action, snapshot.foregroundGuidance);
    const currentSnapshot = await this.workspace.snapshot(input.runId);
    const compiled = await compileForegroundContext(paths, currentSnapshot);
    const previousOpening = previousNarrationOpening(currentSnapshot);
    const narrator = await this.generateNarration({
      runId: input.runId,
      turnId,
      action: input.action,
      compiled,
      selectedActionScope: selectedOption?.id.startsWith("opening_")
        ? String(selectedOption.effect?.intent || "")
        : "",
      previousOpening,
      onEvent: input.onEvent,
    });
    const surface = validateForegroundSurface(narrator.text, previousOpening);
    if (!surface.ok) {
      await this.workspace.updateMetadata(input.runId, {
        status: "FAILED",
        lastError: surface.reason || "NARRATION_REJECTED",
      });
      throw new Error(surface.reason || "NARRATION_REJECTED");
    }

    input.onEvent?.({
      type: "narration.complete",
      data: { narration: narrator.text },
    });

    let optionsProvider;
    let framing = "";
    let options: OpenNovelOption[] = [];
    let tension = "reader-directed";
    let storyComplete = false;
    const warnings: RuntimeWarning[] = [
      ...surface.warnings,
      ...shadowContinuityWarnings(narrator.text, input.action),
    ];
    const optionsRequest = {
      profile: "options" as const,
      messages: buildOptionsMessages(input.action, narrator.text, currentSnapshot, compiled),
      temperature: 0.55,
      maxTokens: 4_000,
      json: true,
      stream: false,
    };
    try {
      optionsProvider = await this.provider.generate(optionsRequest);
      await this.workspace.recordModelCall(input.runId, turnId, "options", optionsRequest, optionsProvider);
      const parsed = parseOptions(
        optionsProvider.text,
        turnId,
        input.action,
        currentSnapshot.previousOptions,
      );
      framing = parsed.framing;
      options = parsed.options;
      tension = parsed.tension;
      storyComplete = parsed.storyComplete;
      input.onEvent?.({ type: "options.complete", data: { options, framing } });
    } catch (error) {
      const message = String((error as Error).message || error);
      await this.workspace.recordModelCall(
        input.runId,
        turnId,
        "options",
        optionsRequest,
        undefined,
        error,
      );
      const warning: RuntimeWarning = {
        code: "OPTIONS_UNAVAILABLE",
        message,
        severity: "LOW",
        blocksPlayer: false,
      };
      warnings.push(warning);
      input.onEvent?.({ type: "runtime.warning", data: warning });
      input.onEvent?.({ type: "options.complete", data: { options: [], framing: "", error: message } });
    }

    for (const warning of warnings) {
      input.onEvent?.({ type: "runtime.warning", data: warning });
      await this.workspace.recordSceneEvent(input.runId, {
        type: "shadow_warning",
        turnId,
        ...warning,
      });
    }
    await this.workspace.recordShadowAudit(input.runId, {
      runId: input.runId,
      turnId,
      readerAction: input.action,
      suspectedDurableConflicts: warnings
        .filter((warning) => warning.severity === "HIGH")
        .map((warning) => warning.message),
      knowledgeWarnings: warnings
        .filter((warning) => warning.code.includes("SECRET"))
        .map((warning) => warning.message),
      authorityWarnings: warnings
        .filter((warning) => /ACTION|COMMITMENT|AUTHORITY/.test(warning.code))
        .map((warning) => warning.message),
      sectionDriftWarnings: [],
      severity: warnings.some((warning) => warning.severity === "HIGH")
        ? "HIGH"
        : warnings.some((warning) => warning.severity === "MEDIUM")
          ? "MEDIUM"
          : warnings.length ? "LOW" : "NONE",
      blocksPlayer: false,
      observedAt: new Date().toISOString(),
    });

    await this.workspace.updateMetadata(input.runId, { status: "COMMITTING" });
    const result: TurnResult = {
      runId: input.runId,
      turnId,
      turnNumber,
      narration: narrator.text,
      options,
      framing,
      tension,
      storyComplete,
      warnings,
      narrator,
      optionsProvider,
      committedAt: new Date().toISOString(),
    };
    await this.workspace.commitTurn(input.runId, {
      turnId,
      action: input.action,
      result,
      selectedOption,
    });
    await this.workspace.enqueueStorykeeper(input.runId, {
      id: `inbox_${turnId}_${Date.now()}`,
      turnId,
      action: input.action,
      narration: narrator.text,
      recentCanonBefore: compiled.recentCanonExcerpt,
      selectedEffect: selectedOption?.effect || null,
      createdAt: result.committedAt,
    });
    await this.mirror.publish({
      kind: "turn.committed",
      runId: input.runId,
      payload: result,
    }).catch(async (error) => {
      const warning: RuntimeWarning = {
        code: "DATABASE_MIRROR_DEFERRED",
        message: String((error as Error).message || error),
        severity: "MEDIUM",
        blocksPlayer: false,
      };
      result.warnings.push(warning);
      input.onEvent?.({ type: "runtime.warning", data: warning });
    });
    input.onEvent?.({ type: "turn.committed", data: result });
    this.storykeeper.kick(input.runId);
    return result;
  }

  private async generateNarration(input: {
    runId: string;
    turnId: string;
    action: string;
    compiled: Awaited<ReturnType<typeof compileForegroundContext>>;
    selectedActionScope: string;
    previousOpening: string;
    onEvent?: (event: TurnEvent) => void;
  }) {
    const baseMessages = buildNarratorMessages(
      input.action,
      input.compiled,
      input.selectedActionScope,
    );
    let lastError: unknown;
    for (let attempt = 1; attempt <= (input.previousOpening ? 2 : 1); attempt += 1) {
      const messages = attempt === 1
        ? baseMessages
        : [
            ...baseMessages,
            {
              role: "user" as const,
              content: "上一稿完整重复了 Recent Canon 的开头。丢弃那一稿，从 Canon 最后一句之后写全新的向前 beat；不要复述或换词重演。",
            },
          ];
      const stream = new RepeatAwareStream(input.previousOpening, (text) => {
        input.onEvent?.({ type: "narration.delta", data: { text } });
      });
      const request = {
        profile: "narrator" as const,
        messages,
        temperature: 0.86,
        maxTokens: 8_000,
        json: false,
        stream: true,
        onDelta: (text: string) => stream.push(text),
      };
      try {
        const result = await this.provider.generate(request);
        const repeated = stream.finish(result.text);
        await this.workspace.recordModelCall(input.runId, input.turnId, "narrator", request, result);
        if (repeated && attempt === 1) {
          lastError = new Error("REPEATED_OPENING");
          continue;
        }
        const validation = validateForegroundSurface(result.text, input.previousOpening);
        if (!validation.ok && validation.reason === "REPEATED_OPENING" && attempt === 1) {
          lastError = new Error(validation.reason);
          continue;
        }
        return result;
      } catch (error) {
        lastError = error;
        await this.workspace.recordModelCall(input.runId, input.turnId, "narrator", request, undefined, error);
        if (attempt === 1 && String((error as Error).message).includes("REPEATED_OPENING")) continue;
        throw error;
      }
    }
    throw lastError || new Error("Narrator failed");
  }
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

function resolveBoundOption(
  bound: BoundOption | null,
  options: OpenNovelOption[],
  action: string,
) {
  if (!bound) return null;
  const match = options.find((option) => option.id === bound.id && option.label === bound.label);
  if (!match || match.label !== action) return null;
  return match;
}
