export type RuntimeConfirmedManeuverContextV1 = {
  schemaVersion: "openovel_confirmed_maneuver_context_v1";
  instruction: string;
  preparedAtTurnNumber: number;
  sourceResultIds: string[];
  summaries: Array<{
    resultId: string;
    decisionForm: "CONVERSATION" | "INVESTIGATION" | "LEVERAGE" | "CUSTOM_PLAN";
    title: string;
    content: string;
    sceneKey: string;
    turnNumber: number;
  }>;
  visibleFacts: Array<{
    factKey: string;
    content: string;
    sourceResultId: string;
  }>;
  consumedLeverageKeys: string[];
};

type StagedContext = {
  context: RuntimeConfirmedManeuverContextV1;
  expiresAt: number;
};

const staged = new Map<string, StagedContext>();
const TTL_MS = 2 * 60_000;

export function stageConfirmedManeuverRuntimeContext(input: {
  runId: string;
  stateRevision: number;
  context: RuntimeConfirmedManeuverContextV1;
}) {
  prune();
  staged.set(key(input.runId, input.stateRevision), {
    context: structuredClone(input.context),
    expiresAt: Date.now() + TTL_MS,
  });
}

export function takeConfirmedManeuverRuntimeContext(
  runId: string,
  stateRevision: number,
) {
  prune();
  const contextKey = key(runId, stateRevision);
  const item = staged.get(contextKey);
  staged.delete(contextKey);
  return item ? structuredClone(item.context) : null;
}

export function clearConfirmedManeuverRuntimeContext(
  runId: string,
  stateRevision: number,
) {
  staged.delete(key(runId, stateRevision));
}

export function renderConfirmedManeuverRuntimeContext(
  context: RuntimeConfirmedManeuverContextV1,
) {
  const summaries = context.summaries
    .map((item) => `- [${item.decisionForm}] ${compact(item.title, 160)}：${compact(item.content, 900)}`)
    .join("\n");
  const facts = context.visibleFacts.length
    ? `\n玩家已经掌握的确认事实：\n${context.visibleFacts.map((item) => `- ${compact(item.content, 700)}`).join("\n")}`
    : "";
  const consumed = context.consumedLeverageKeys.length
    ? `\n已经打出并消耗的筹码：${context.consumedLeverageKeys.map((item) => compact(item, 120)).join("、")}`
    : "";
  return [
    "## 已确认的主动谋划上下文",
    context.instruction,
    summaries,
    facts,
    consumed,
  ].filter(Boolean).join("\n");
}

function compact(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function key(runId: string, revision: number) {
  return `${runId}:${Math.max(0, Math.floor(revision))}`;
}

function prune() {
  const now = Date.now();
  for (const [itemKey, item] of staged.entries()) {
    if (item.expiresAt <= now) staged.delete(itemKey);
  }
}
