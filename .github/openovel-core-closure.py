from pathlib import Path
import json
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected one regex match, found {count}")
    return updated


# Shared export.
path = "packages/shared/src/index.ts"
text = read(path)
if 'export * from "./openovel-result-v2";' not in text:
    text = text.rstrip() + '\nexport * from "./openovel-result-v2";\n'
write(path, text)

# Package scripts.
path = "apps/api/package.json"
package = json.loads(read(path))
scripts = package["scripts"]
scripts["test:openovel-result-v2"] = "node --import tsx --test src/openovel-result-v2.spec.ts"
scripts["test:legacy-terminal"] = "node --import tsx --test src/openovel-terminal/legacy-terminal.spec.ts"
scripts["test:authoritative-terminal-order"] = "node --import tsx --test src/openovel-terminal/authoritative-terminal-order.architecture.spec.ts"
for command in ["pnpm run test:openovel-result-v2", "pnpm run test:legacy-terminal", "pnpm run test:authoritative-terminal-order"]:
    if command not in scripts["test"]:
        scripts["test"] += f" && {command}"
write(path, json.dumps(package, ensure_ascii=False, indent=2) + "\n")

path = "apps/web/package.json"
package = json.loads(read(path))
package["scripts"]["test:openovel-result-v2"] = "node --test tests/openovel-result-v2.test.mjs"
check = "node --check tests/openovel-result-v2.test.mjs"
if check not in package["scripts"]["typecheck"]:
    package["scripts"]["typecheck"] += f" && {check}"
write(path, json.dumps(package, ensure_ascii=False, indent=2) + "\n")

# Rooms Result API first reads the authoritative ledger for every engine.
path = "apps/api/src/rooms.service.ts"
text = read(path)
import_anchor = 'import { OPENOVEL_ENGINE_VERSION } from "./openovel-adapter/openovel-runtime.client";'
if 'from "./openovel-result-v2"' not in text:
    text = replace_once(text, import_anchor, import_anchor + '\nimport { readOpenNovelResultV2 } from "./openovel-result-v2";', "rooms result import")
result_anchor = '''  async result(user: AuthenticatedUser, roomId: string) {
    const engine = await this.prisma.storyRun.findUnique({ where: { id: roomId }, select: { engineVersion: true } });'''
result_replacement = '''  async result(user: AuthenticatedUser, roomId: string) {
    const authoritative = await readOpenNovelResultV2(this.prisma, user, roomId);
    if (authoritative) return authoritative;
    const engine = await this.prisma.storyRun.findUnique({ where: { id: roomId }, select: { engineVersion: true } });'''
if "const authoritative = await readOpenNovelResultV2(this.prisma, user, roomId);" not in text:
    text = replace_once(text, result_anchor, result_replacement, "rooms result authority")
write(path, text)

# Generic final/legacy Narrative source is read from immutable outbox payload.
path = "apps/api/src/openovel-narrative-projector/narrative-source-reader.ts"
text = read(path)
anchor = '''    if (task.id !== fence.taskId
      || task.status !== "running"
      || task.leaseOwner !== fence.leaseOwner
      || task.leaseVersion !== fence.leaseVersion) {
      throw new Error("NARRATIVE_SOURCE_LEASE_LOST");
    }
    const windowId = required(task.windowId, "windowId");'''
replacement = '''    if (task.id !== fence.taskId
      || task.status !== "running"
      || task.leaseOwner !== fence.leaseOwner
      || task.leaseVersion !== fence.leaseVersion) {
      throw new Error("NARRATIVE_SOURCE_LEASE_LOST");
    }
    const terminalSource = terminalSourceFromTask(task, jsonRecord(task.resultJson));
    if (terminalSource) return terminalSource;
    const windowId = required(task.windowId, "windowId");'''
if "terminalSourceFromTask(task" not in text:
    text = replace_once(text, anchor, replacement, "terminal narrative source branch")
helper = '''function terminalSourceFromTask(task: any, result: Record<string, any> | null): OpenNovelNarrativeSourceV1 | null {
  const sourceKind = String(result?.sourceKind ?? "");
  if (sourceKind !== "FINALE" && sourceKind !== "LEGACY_TERMINAL") return null;
  const payload = jsonRecord(result?.sourcePayload);
  if (!payload) throw new Error("NARRATIVE_TERMINAL_SOURCE_MISSING");
  const sourceCommitHash = required(String(result?.sourceCommitHash ?? ""), "sourceCommitHash");
  const roleId = required(String(payload.roleId ?? task.roleId ?? ""), "roleId");
  const runId = required(String(payload.runId ?? task.runId ?? ""), "runId");
  const fallbackLines = Array.isArray(payload.fallbackLines)
    ? payload.fallbackLines.map((line: unknown) => String(line).trim()).filter(Boolean)
    : [];
  if (!fallbackLines.length) throw new Error("NARRATIVE_TERMINAL_FALLBACK_REQUIRED");
  return Object.freeze({
    schemaVersion: OPENOVEL_NARRATIVE_SOURCE_SCHEMA_V1,
    sourceKind,
    sourceCommitHash,
    runId,
    nodeId: typeof payload.nodeId === "string" ? payload.nodeId : task.nodeId,
    windowId: typeof payload.windowId === "string" ? payload.windowId : null,
    roleId,
    entryType: String(payload.entryType || "OPENOVEL_ENDING"),
    visibility: String(payload.visibility || "private"),
    worldSequence: Number.isInteger(payload.worldSequence) ? payload.worldSequence : null,
    dedupeKey: required(String(payload.dedupeKey ?? ""), "dedupeKey"),
    providerInput: payload.providerInput ?? {},
    fallbackLines,
    forbiddenPhrases: Array.isArray(payload.forbiddenPhrases) ? payload.forbiddenPhrases.map(String) : [],
    forbiddenClaims: Array.isArray(payload.forbiddenClaims) ? payload.forbiddenClaims.map(String) : [],
    sourceTaskResult: task.resultJson as Prisma.JsonValue | null,
  });
}

'''
if "function terminalSourceFromTask" not in text:
    text = replace_once(text, "function assertCommitEnvelope", helper + "function assertCommitEnvelope", "terminal source helper")
write(path, text)

# B0 finalization: one authoritative transaction, then asynchronous prose.
path = "apps/api/src/b0-settlement/b0-settlement-pipeline.service.ts"
text = read(path)
import_anchor = 'import { PrismaService } from "../prisma.service";'
if 'authoritative-result-builder' not in text:
    text = replace_once(text, import_anchor, import_anchor + '\nimport { buildOpenNovelAuthoritativeResultV2, sha256CanonicalValue } from "../openovel-terminal/authoritative-result-builder";', "B0 result builder import")
new_finalize = '''  private async finalizeRun(runId: string, totalWindows: number) {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: { roles: { orderBy: { id: "asc" } } },
    });
    if (!run || run.status === "completed") return;
    const latestWindow = await this.prisma.actionWindow.findFirst({
      where: { runId, status: "COMPLETED" },
      include: { resolutionWorkflow: true },
      orderBy: { createdAt: "desc" },
    });
    const nodeId = latestWindow?.nodeId ?? run.currentNodeId;
    if (!nodeId) throw hard("B0_FINAL_NODE_MISSING", "The final authoritative node is unavailable.");
    const value = jsonRecord(latestWindow?.resolutionWorkflow?.rulesOutputJson);
    const envelope = value?.schemaVersion === "b0-commit-envelope-v1" ? assertCommitEnvelope(value) : null;
    const plan = envelope ? await this.publicationPlan(envelope) : null;
    const canon = await this.prisma.canonFact.findMany({
      where: { runId, status: "confirmed", visibility: "public" },
      select: { factKey: true, content: true },
      orderBy: { factKey: "asc" },
    });
    const completedAt = new Date().toISOString();
    const decisionHash = envelope?.manifest.commitHash ?? sha256CanonicalValue({ runId, totalWindows, worldSequence: run.worldSequence, latestWindowId: latestWindow?.id ?? null });
    const seatResults = run.roles.map((role) => {
      const summaries = plan?.deliveries.filter((delivery) => delivery.recipientActorId === role.id).map((delivery) => delivery.summary) ?? [];
      const summary = summaries.join(" ").trim() || `${role.roleName} completed ${totalWindows} synchronized situations.`;
      return Object.freeze({
        roleId: role.id,
        roleKey: role.roleKey,
        roleName: role.roleName,
        outcome: "RESOLVED" as const,
        title: `${role.roleName}: final recorded position`,
        summary,
        causes: summaries.length ? summaries : ["The final committed settlement fixed this role's position."],
      });
    });
    const endingSummary = `The shared world closes after ${totalWindows} synchronized situations.`;
    const authoritativeResult = buildOpenNovelAuthoritativeResultV2({
      sourceKind: "B0_FINALE",
      runId,
      title: run.title,
      worldId: run.templateKey,
      decisionHash,
      worldSequence: envelope?.manifest.committedWorldSequence ?? run.worldSequence,
      completedAt,
      ending: Object.freeze({
        scope: "STORY",
        endingKey: "b0_synchronized_world_complete",
        title: "The synchronized world is complete",
        summary: endingSummary,
        protagonistFate: "Every role keeps the consequences recorded by the authoritative settlement.",
        aftermath: seatResults.map((seat) => seat.summary),
      }),
      canon,
      result: Object.freeze({ title: "The synchronized world is complete", summary: endingSummary, worldOutcome: seatResults.map((seat) => seat.summary).join(" ") }),
      seatResults,
    });
    const state = jsonRecord(run.stateJson) ?? {};
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.storyRun.findUnique({ where: { id: runId }, select: { status: true, stateJson: true } });
      if (!current || current.status === "completed") return;
      await tx.canonFact.upsert({
        where: { runId_factKey: { runId, factKey: "b0.final.authoritative-result" } },
        update: {},
        create: {
          runId,
          sourceNodeId: nodeId,
          factKey: "b0.final.authoritative-result",
          content: authoritativeResult.result.worldOutcome,
          status: "confirmed",
          visibility: "public",
          sourceEventIdsJson: ["b0-authoritative-finale-v2"] as Prisma.InputJsonValue,
          sourceActionIdsJson: [] as Prisma.InputJsonValue,
          knownByRoleIdsJson: run.roles.map((role) => role.id) as Prisma.InputJsonValue,
        },
      });
      await tx.storyRun.update({
        where: { id: runId },
        data: {
          status: "completed",
          currentDay: totalWindows,
          summary: authoritativeResult.result.summary,
          stateJson: {
            ...state,
            openNovelResultV2: authoritativeResult,
            b0: {
              ...(jsonRecord(state.b0) ?? {}),
              enabled: true,
              status: "COMPLETED",
              totalWindows,
              completedAt,
              authoritativeResultStatus: "FINALIZED",
              structuredResultReady: true,
              sourceCommitHash: authoritativeResult.sourceCommitHash,
            },
          } as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      for (const role of run.roles) {
        const seat = seatResults.find((candidate) => candidate.roleId === role.id)!;
        const fallbackLines = [authoritativeResult.ending.summary, seat.summary, ...seat.causes];
        await tx.storyTaskOutbox.upsert({
          where: { dedupeKey: `b0-ending:${runId}:${role.id}:${authoritativeResult.sourceCommitHash}` },
          update: {},
          create: {
            runId,
            nodeId,
            windowId: latestWindow?.id ?? null,
            roleId: role.id,
            dedupeKey: `b0-ending:${runId}:${role.id}:${authoritativeResult.sourceCommitHash}`,
            taskType: "B0_NARRATIVE_GENERATION",
            status: "pending",
            inputRefId: authoritativeResult.sourceCommitHash,
            checkpointKey: "B0_AUTHORITATIVE_RESULT_FINALIZED",
            resultJson: {
              schemaVersion: "openovel-narrative-task-result-v1",
              authoritativeResultStatus: "FINALIZED",
              structuredResultReady: true,
              narrativeStatus: "PENDING",
              sourceKind: "FINALE",
              sourceCommitHash: authoritativeResult.sourceCommitHash,
              sourcePayload: {
                runId,
                nodeId,
                windowId: latestWindow?.id ?? null,
                roleId: role.id,
                entryType: "B0_ENDING",
                visibility: "private",
                worldSequence: authoritativeResult.worldSequence,
                dedupeKey: `b0-ending:${runId}:${role.id}`,
                providerInput: {
                  authoritativeResult,
                  recipientSeat: seat,
                  guidance: { schemaVersion: "openovel-ending-guidance-v1", styleDirectives: ["Render only the supplied authoritative result.", "Do not alter outcome, resources, causes, winners or role visibility."] },
                },
                fallbackLines,
                forbiddenPhrases: run.roles.filter((candidate) => candidate.id !== role.id).map((candidate) => candidate.hiddenSecret).filter(Boolean),
                forbiddenClaims: [],
              },
            } as Prisma.InputJsonValue,
          },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
  }
'''
text = regex_once(text, r"  private async finalizeRun\(runId: string, totalWindows: number\) \{.*?\n  \}\n\n  private async rulesetForWindow\(", new_finalize + "\n  private async rulesetForWindow(", "B0 finalizeRun")
write(path, text)

# OpenNovel adapter: Result V2, T19 adapter, completed-history read-only.
path = "apps/api/src/openovel-adapter/openovel-adapter.service.ts"
text = read(path)
import_anchor = 'import { openNovelGameProjection } from "./openovel-game-projection";'
imports = '''import { openNovelGameProjection } from "./openovel-game-projection";
import { projectHistoricalOpenNovelResultV2, readOpenNovelResultV2 } from "../openovel-result-v2";
import { AuthoritativeLegacyTerminalCommitter } from "../openovel-terminal/authoritative-legacy-terminal-committer";
import { LegacyTerminalInputAdapter } from "../openovel-terminal/legacy-terminal-input-adapter";
import { LegacyT20HeadGuard } from "../openovel-terminal/legacy-t20-head-guard";'''
if 'AuthoritativeLegacyTerminalCommitter' not in text:
    text = replace_once(text, import_anchor, imports, "OpenNovel terminal imports")
if "legacyTerminalInputAdapter =" not in text:
    text = replace_once(text, '''export class OpenNovelAdapterService {
  constructor(''', '''export class OpenNovelAdapterService {
  private readonly legacyTerminalInputAdapter = new LegacyTerminalInputAdapter();
  private readonly legacyT20HeadGuard = new LegacyT20HeadGuard();
  private readonly authoritativeLegacyTerminalCommitter: AuthoritativeLegacyTerminalCommitter;

  constructor(''', "OpenNovel terminal fields")
text = replace_once(text, '''    @Inject(OpenNovelRuntimeClient) private readonly runtime: OpenNovelRuntimeClient,
  ) {}''', '''    @Inject(OpenNovelRuntimeClient) private readonly runtime: OpenNovelRuntimeClient,
  ) {
    this.authoritativeLegacyTerminalCommitter = new AuthoritativeLegacyTerminalCommitter(this.prisma);
  }''', "OpenNovel constructor")
text = replace_once(text, '''    if (existing) {
      this.assertRunOwner(existing, user);
      const runtimeRun = await this.runtime.createRun(runtimeCreateInput(runId, product));
      await this.persistRunMirror(existing, runtimeRun);
      return this.projection(existing, runtimeRun);
    }''', '''    if (existing) {
      this.assertRunOwner(existing, user);
      if (existing.status === "completed") {
        const runtimeRun = await this.runtime.getRun(runId);
        return { ...this.projection(existing, runtimeRun), status: "COMPLETED" };
      }
      const runtimeRun = await this.runtime.createRun(runtimeCreateInput(runId, product));
      await this.persistRunMirror(existing, runtimeRun);
      return this.projection(existing, runtimeRun);
    }''', "completed createRun replay")
text = replace_once(text, '''    const runtimeRun = await this.runtime.getRun(runId);
    if (mirrorTurn(run.stateJson) !== runtimeRun.turnNumber) {
      await this.persistRunMirror(run, runtimeRun);
    }
    return this.projection(run, runtimeRun);''', '''    const runtimeRun = await this.runtime.getRun(runId);
    if (run.status !== "completed" && mirrorTurn(run.stateJson) !== runtimeRun.turnNumber) {
      await this.persistRunMirror(run, runtimeRun);
    }
    const projection = this.projection(run, runtimeRun);
    return run.status === "completed" ? { ...projection, status: "COMPLETED" } : projection;''', "completed history getRun")
text = replace_once(text, '''    const run = await this.authorizedRun(user, runId);
    const [runtimeRun, nodes, creditAvailability] = await Promise.all([''', '''    const run = await this.authorizedRun(user, runId);
    const authoritative = await readOpenNovelResultV2(this.prisma, user, runId);
    const [runtimeRun, nodes, creditAvailability] = await Promise.all([''', "game result lookup")
text = replace_once(text, '''    return openNovelGameProjection({
      userId: user.id,
      run,
      runtimeRun,
      game: getGameDefinition(run.templateKey),
      nodes,
      credits: {
        policyVersion: billing.policyVersion,
        meteringMode: creditConfig.meteringMode,
        available: creditAvailability.available,
        personalAvailable: creditAvailability.personalAvailable,
        runAllowanceAvailable: creditAvailability.runAllowanceAvailable,
        standardActionCost: billing.prices.standardAction,
        customActionCost: billing.prices.customAction,
      },
    });''', '''    const projection = openNovelGameProjection({
      userId: user.id,
      run,
      runtimeRun,
      game: getGameDefinition(run.templateKey),
      nodes,
      credits: {
        policyVersion: billing.policyVersion,
        meteringMode: creditConfig.meteringMode,
        available: creditAvailability.available,
        personalAvailable: creditAvailability.personalAvailable,
        runAllowanceAvailable: creditAvailability.runAllowanceAvailable,
        standardActionCost: billing.prices.standardAction,
        customActionCost: billing.prices.customAction,
      },
    });
    return authoritative ? { ...projection, status: "COMPLETED", resultReady: true, authoritativeResultStatus: "FINALIZED", structuredResultReady: true, ending: authoritative.ending } : projection;''', "game completed projection")
result_method = '''  async result(user: AuthenticatedUser, runId: string) {
    this.assertEnabled();
    const authoritative = await readOpenNovelResultV2(this.prisma, user, runId);
    if (authoritative) return authoritative;
    const run = await this.authorizedRun(user, runId);
    const runtimeRun = await this.runtime.getRun(runId);
    if (runtimeRun.status !== "COMPLETED" || !runtimeRun.ending) {
      throw new ConflictException({ code: "RESULT_NOT_READY", message: "The authoritative result is not finalized yet." });
    }
    const membership = run.players.find((player: any) => player.userId === user.id);
    return projectHistoricalOpenNovelResultV2({ run, runtimeRun, role: membership?.role ?? null });
  }
'''
text = regex_once(text, r"  async result\(user: AuthenticatedUser, runId: string\) \{.*?\n  \}\n\n  async submitDecision\(", result_method + "\n  async submitDecision(", "OpenNovel Result V2 method")
text = replace_once(text, '''    const runtimeBefore = await this.runtime.getRun(runId);
    const nextTurn = runtimeBefore.turnNumber + 1;''', '''    if (run.status === "completed") this.legacyT20HeadGuard.assertCompletedHistoryReadOnly(run.status);
    const runtimeBefore = await this.runtime.getRun(runId);
    const nextTurn = runtimeBefore.turnNumber + 1;''', "completed history mutation guard")
text = replace_once(text, '''    const syntheticNode = await this.prisma.sceneNode.create({''', '''    if (this.legacyT20HeadGuard.shouldAdaptUnfinished(runtimeBefore.turnNumber)) {
      const terminalInput = this.legacyTerminalInputAdapter.adapt({ run, runtimeRun: runtimeBefore, role, userId: user.id, action, actionIdempotencyKey, requestHash });
      const authoritativeResult = await this.authoritativeLegacyTerminalCommitter.commit(terminalInput);
      const committed = { turnId: "T20", turnNumber: 20, narration: authoritativeResult.result.summary, ending: authoritativeResult.ending, authoritativeResultStatus: "FINALIZED", structuredResultReady: true, sourceCommitHash: authoritativeResult.sourceCommitHash };
      await onEvent({ type: "turn.committed", data: committed });
      return committed;
    }
    this.legacyT20HeadGuard.assertNoNewT20Head(nextTurn, "ADVANCE");

    const syntheticNode = await this.prisma.sceneNode.create({''', "T19 authoritative adapter")
write(path, text)

# Real Result page, no fixture ending.
path = "apps/web/public/platform.js"
text = read(path)
if "let resultRefreshTimer = null;" not in text:
    text = replace_once(text, "let roomDialogRecoveryTimer = null;", "let roomDialogRecoveryTimer = null;\nlet resultRefreshTimer = null;", "result timer declaration")
if "if (resultRefreshTimer)" not in text:
    text = replace_once(text, "  if (roomDialogRecoveryTimer) { clearInterval(roomDialogRecoveryTimer); roomDialogRecoveryTimer = null; }", "  if (roomDialogRecoveryTimer) { clearInterval(roomDialogRecoveryTimer); roomDialogRecoveryTimer = null; }\n  if (resultRefreshTimer) { clearTimeout(resultRefreshTimer); resultRefreshTimer = null; }", "result timer cleanup")
result_js = '''const OPENOVEL_RESULT_NARRATIVE_PENDING = new Set(["PENDING", "GENERATING", "VALIDATING", "FAILED_RETRYABLE"]);
const OPENOVEL_RESULT_NARRATIVE_STATUSES = new Set(["PENDING", "GENERATING", "VALIDATING", "PUBLISHED", "FALLBACK_PUBLISHED", "FAILED_RETRYABLE"]);

function resultV2Markup(result) {
  const player = result.player || {};
  const ending = result.ending || {};
  const authority = result.result || {};
  const narrative = result.narrative || {};
  const canon = Array.isArray(result.canon) ? result.canon : [];
  const causes = Array.isArray(player.causes) ? player.causes : [];
  const published = result.narrativeStatus === "PUBLISHED" || result.narrativeStatus === "FALLBACK_PUBLISHED";
  const narrativeText = published ? String(narrative.content || "") : String(narrative.message || "权威结局已确认，故事化结局正在生成。");
  return `<section class="page-frame result-v2" data-openovel-result-v2 data-result-schema="${esc(result.schemaVersion)}">
    <header class="result-v2__header"><div><span class="session-complete">✓ Session Complete</span><h1>${esc(ending.title || authority.title || "Authoritative result")}</h1></div><dl><div><dt>Authority</dt><dd>${esc(result.authoritativeResultStatus)}</dd></div><div><dt>Narrative</dt><dd data-narrative-status>${esc(result.narrativeStatus)}</dd></div><div><dt>World sequence</dt><dd>${esc(result.worldSequence)}</dd></div></dl></header>
    <section class="result-v2__authority" data-structured-result-ready="${result.structuredResultReady === true}"><article><span class="eyebrow">World result</span><h2>${esc(authority.title || ending.title)}</h2><p>${esc(authority.summary || ending.summary)}</p><p>${esc(authority.worldOutcome || "")}</p></article><article><span class="eyebrow">Your seat</span><h2>${esc(player.roleName || "Participant")}</h2><strong>${esc(player.title || "Recorded outcome")}</strong><p>${esc(player.summary || "Your authoritative seat result is final.")}</p></article><article><span class="eyebrow">Ending</span><h2>${esc(ending.endingKey || "finalized")}</h2><p>${esc(ending.protagonistFate || ending.summary || "")}</p></article></section>
    <section class="result-v2__details"><article><h2>Authoritative causes</h2>${causes.length ? `<ol>${causes.map((cause) => `<li>${esc(cause)}</li>`).join("")}</ol>` : `<p class="muted">No additional role-scoped causes were recorded.</p>`}</article><article><h2>Canon</h2>${canon.length ? `<ul>${canon.map((fact) => `<li><strong>${esc(fact.factKey)}</strong><span>${esc(fact.content)}</span></li>`).join("")}</ul>` : `<p class="muted">The final structured result is the current canon.</p>`}</article></section>
    <section class="result-v2__narrative ${published ? "is-published" : "is-pending"}" data-narrative-projection><div><span class="eyebrow">OpenNovel presentation</span><h2>${result.narrativeStatus === "FALLBACK_PUBLISHED" ? "Fact-safe fallback" : "Story presentation"}</h2></div><p>${esc(narrativeText)}</p></section>
    <div class="result-actions"><button class="btn primary" data-action="play-again">Play Again</button><button class="btn" data-action="other-role">Try Another Role</button><button class="btn" data-action="back-worlds">Back to Worlds</button></div>
  </section>`;
}

function renderResult() {
  const runId = String(params.get("runId") || "").trim();
  if (!runId || !sessionToken()) { location.assign(`/auth?returnTo=${encodeURIComponent(`/game/result?runId=${runId}`)}`); return; }
  appShell(`<section class="page-frame result-v2" data-result-v2-state="loading"><p class="muted">Loading the authoritative result…</p></section>`, "worlds");
  void hydrateResult(runId);
}

async function hydrateResult(runId) {
  try {
    const result = await request(`/api/v4/rooms/${encodeURIComponent(runId)}/result`);
    if (result?.schemaVersion !== "openovel-result-v2" || result?.authoritativeResultStatus !== "FINALIZED" || result?.structuredResultReady !== true || !OPENOVEL_RESULT_NARRATIVE_STATUSES.has(result?.narrativeStatus)) throw new Error("The server returned an invalid authoritative result contract.");
    appShell(resultV2Markup(result), "worlds");
    if (OPENOVEL_RESULT_NARRATIVE_PENDING.has(result.narrativeStatus)) resultRefreshTimer = setTimeout(() => { resultRefreshTimer = null; if (location.pathname.replace(/\/$/, "") === "/game/result") void hydrateResult(runId); }, 2500);
    return true;
  } catch (error) {
    appShell(`<section class="page-frame result-v2" data-result-v2-state="error"><h1>Result unavailable</h1><p class="notice">${esc(error.message || "Unable to load this result.")}</p></section>`, "worlds");
    return false;
  }
}

async function loadImageSource'''
text = regex_once(text, r"function renderResult\(\) \{.*?\nasync function loadImageSource", result_js, "real Result page")
write(path, text)

# Responsive Result V2 presentation.
path = "apps/web/public/platform.css"
text = read(path)
marker = "/* OPENOVEL_RESULT_V2 */"
if marker not in text:
    text = text.rstrip() + '''

/* OPENOVEL_RESULT_V2 */
body:has(.result-v2) { min-width:0; }
.result-v2 { width:min(1180px,calc(100% - 32px)); min-width:0; max-width:1180px; margin:20px auto 42px; overflow:hidden; overflow-wrap:anywhere; }
.result-v2__header { display:flex; min-width:0; align-items:flex-start; justify-content:space-between; gap:24px; padding-bottom:22px; border-bottom:1px solid #e1e5ed; }
.result-v2__header h1 { margin:12px 0 0; font-size:clamp(34px,4.2vw,54px); line-height:1.05; }
.result-v2__header dl { display:grid; min-width:260px; gap:8px; margin:0; }
.result-v2__header dl div { display:flex; justify-content:space-between; gap:18px; padding:9px 12px; border-radius:9px; background:#f7f4ff; }
.result-v2__header dt { color:#69758f; }.result-v2__header dd { margin:0; color:#5e32d3; font-weight:700; }
.result-v2__authority { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:18px; margin-top:22px; }
.result-v2__authority article,.result-v2__details article,.result-v2__narrative { min-width:0; padding:22px; border:1px solid #e1e5ed; border-radius:14px; background:#fff; }
.result-v2__authority h2,.result-v2__details h2,.result-v2__narrative h2 { margin:8px 0 10px; }
.result-v2__authority p,.result-v2__details p,.result-v2__narrative p,.result-v2 li,.result-v2 span { overflow-wrap:anywhere; }
.result-v2__details { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:18px; }
.result-v2__details ol,.result-v2__details ul { display:grid; gap:10px; margin:12px 0 0; padding-left:22px; }
.result-v2__details li span { display:block; margin-top:4px; color:#65708a; }
.result-v2__narrative { display:grid; grid-template-columns:minmax(190px,.35fr) minmax(0,1fr); gap:24px; margin-top:18px; background:#faf8ff; }
.result-v2__narrative.is-published { border-color:#cfc1f7; background:#fff; }
.result-v2 .result-actions { grid-template-columns:repeat(3,minmax(0,1fr)); }
@media(max-width:760px) { .result-v2__header { flex-direction:column; }.result-v2__header dl { width:100%; min-width:0; }.result-v2__authority,.result-v2__details,.result-v2__narrative { grid-template-columns:minmax(0,1fr); } }
@media(max-width:520px) { body:has(.result-v2) { min-width:0; overflow-x:hidden; }.result-v2 { width:auto; min-width:0; max-width:100%; margin:10px; padding:18px 14px; }.result-v2__header h1 { font-size:34px; }.result-v2__authority article,.result-v2__details article,.result-v2__narrative { min-width:0; padding:17px; }.result-v2 .result-actions { grid-template-columns:minmax(0,1fr); gap:10px; }.result-v2 .result-actions .btn { width:100%; min-width:0; } }
''' + "\n"
write(path, text)
