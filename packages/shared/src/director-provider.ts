declare const process: { env?: Record<string, string | undefined> };

export type DirectorProviderName = "deepseek" | "mock";

export type DirectorUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type DirectorProviderMeta = {
  provider: DirectorProviderName;
  model: string;
  status: "completed" | "failed" | "mock_fallback";
  usage?: DirectorUsage;
  errorCode?: string;
  errorMessage?: string;
  fallbackReason?: string;
};

export type DirectorNodeInput = {
  templateName: string;
  nodeTitle: string;
  nodeGoal?: string;
  publicNarration?: string;
  resolutionSummary: string;
  nextHook: string;
  dangerBefore: number;
  dangerAfter: number;
  actions: Array<{ roleId?: string; roleName?: string; method?: string; intent?: string; riskLevel?: string }>;
};

export type DirectorNodeOutput = DirectorProviderMeta & {
  summary: string;
  publicNarration: string;
  nextNodeHook: string;
  actionResults: Array<{ roleId?: string; roleName?: string; result: string; text: string }>;
  privateResults: Array<{ roleId?: string; roleName?: string; privateNote: string }>;
};

export type DirectorChapterInput = {
  templateName: string;
  title: string;
  segments: string[];
  roles: Array<{ id?: string; roleName?: string; personalGoal?: string }>;
  fallbackNextHook: string;
};

export type DirectorChapterOutput = DirectorProviderMeta & {
  title: string;
  content: string;
  nextHook: string;
  highlights: Array<{ roleName?: string; highlight: string }>;
  keyChoices: Array<{ node: number; choice: string }>;
};

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-pro";

function env(name: string) {
  return process.env?.[name];
}

function configuredProvider(): DirectorProviderName {
  const explicit = (env("AI_DIRECTOR_PROVIDER") || "").trim().toLowerCase();
  if (explicit === "deepseek") return "deepseek";
  if (explicit === "mock") return "mock";
  return env("DEEPSEEK_API_KEY") ? "deepseek" : "mock";
}

function configuredModel(provider: DirectorProviderName) {
  if (provider === "deepseek") return env("DEEPSEEK_MODEL") || DEFAULT_MODEL;
  return "mock-director-v1";
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9._\-]+/gi, "sk-[REDACTED]")
    .slice(0, 360);
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

async function callDeepSeekJson(system: string, user: Record<string, unknown>) {
  const apiKey = env("DEEPSEEK_API_KEY");
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required when AI_DIRECTOR_PROVIDER=deepseek");
  const baseUrl = (env("DEEPSEEK_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = env("DEEPSEEK_MODEL") || DEFAULT_MODEL;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      stream: false,
      temperature: 0.2
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = asString((payload as { error?: { code?: unknown } }).error?.code, `http_${response.status}`);
    const msg = asString((payload as { error?: { message?: unknown } }).error?.message, response.statusText);
    throw new Error(`${code}: ${msg}`);
  }
  const text = asString((payload as any).choices?.[0]?.message?.content, "{}");
  const parsed = safeJsonObject(JSON.parse(text));
  const usagePayload = safeJsonObject((payload as any).usage);
  return {
    model,
    parsed,
    usage: {
      promptTokens: Number(usagePayload.prompt_tokens || usagePayload.promptTokens || 0) || undefined,
      completionTokens: Number(usagePayload.completion_tokens || usagePayload.completionTokens || 0) || undefined,
      totalTokens: Number(usagePayload.total_tokens || usagePayload.totalTokens || 0) || undefined
    }
  };
}

function mockResolveNode(input: DirectorNodeInput, fallbackReason?: string): DirectorNodeOutput {
  const model = "mock-director-v1";
  const summary = input.resolutionSummary;
  const actionResults = input.actions.map((action) => ({
    roleId: action.roleId,
    roleName: action.roleName,
    result: "partial_success",
    text: `${action.roleName || "角色"}尝试${action.method || "观察现场"}，获得了线索，但也让异常更接近一步。`
  }));
  return {
    provider: "mock",
    model,
    status: fallbackReason ? "mock_fallback" : "completed",
    fallbackReason,
    summary,
    publicNarration: `${summary} ${input.nextHook}`,
    nextNodeHook: input.nextHook,
    actionResults,
    privateResults: input.actions.map((action) => ({
      roleId: action.roleId,
      roleName: action.roleName,
      privateNote: `${action.roleName || "角色"}的私密线索被轻微触动。`
    }))
  };
}

function mockGenerateChapter(input: DirectorChapterInput, fallbackReason?: string): DirectorChapterOutput {
  const content = [
    `《${input.title}》`,
    "",
    ...input.segments,
    "",
    input.fallbackNextHook
  ].join("\n");
  return {
    provider: "mock",
    model: "mock-director-v1",
    status: fallbackReason ? "mock_fallback" : "completed",
    fallbackReason,
    title: input.title,
    content,
    nextHook: input.fallbackNextHook,
    highlights: input.roles.map((role) => ({ roleName: role.roleName, highlight: `${role.roleName || "角色"}在关键节点留下了决定性行动。` })),
    keyChoices: input.segments.map((segment, index) => ({ node: index + 1, choice: segment.slice(0, 80) }))
  };
}

export function directorTaskMeta(result: DirectorProviderMeta) {
  return {
    provider: result.provider,
    model: result.model,
    status: result.status,
    usage: result.usage,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    fallbackReason: result.fallbackReason
  };
}

export async function resolveNodeWithDirector(input: DirectorNodeInput): Promise<DirectorNodeOutput> {
  const provider = configuredProvider();
  if (provider === "mock") return mockResolveNode(input);
  try {
    const response = await callDeepSeekJson(
      "你是 AI 多人故事局的导演。只输出 JSON，不输出解释。JSON 字段：summary, publicNarration, nextNodeHook, actionResults, privateResults。不要包含密钥、Authorization、完整请求头。",
      {
        task: "resolve_node",
        templateName: input.templateName,
        nodeTitle: input.nodeTitle,
        nodeGoal: input.nodeGoal,
        publicNarration: input.publicNarration,
        dangerBefore: input.dangerBefore,
        dangerAfter: input.dangerAfter,
        fallbackResolutionSummary: input.resolutionSummary,
        fallbackNextHook: input.nextHook,
        actions: input.actions
      }
    );
    const parsed = response.parsed;
    const fallback = mockResolveNode(input);
    return {
      provider: "deepseek",
      model: response.model,
      status: "completed",
      usage: response.usage,
      summary: asString(parsed.summary, fallback.summary),
      publicNarration: asString(parsed.publicNarration, fallback.publicNarration),
      nextNodeHook: asString(parsed.nextNodeHook, fallback.nextNodeHook),
      actionResults: asArray(parsed.actionResults, fallback.actionResults),
      privateResults: asArray(parsed.privateResults, fallback.privateResults)
    };
  } catch (error) {
    const fallback = mockResolveNode(input, sanitizeError(error));
    fallback.errorCode = "deepseek_runtime_unavailable";
    fallback.errorMessage = sanitizeError(error);
    return fallback;
  }
}

export async function generateChapterWithDirector(input: DirectorChapterInput): Promise<DirectorChapterOutput> {
  const provider = configuredProvider();
  if (provider === "mock") return mockGenerateChapter(input);
  try {
    const response = await callDeepSeekJson(
      "你是 AI 多人故事局的章节导演。只输出 JSON，不输出解释。JSON 字段：title, content, nextHook, highlights, keyChoices。不要包含密钥、Authorization、完整请求头。",
      {
        task: "generate_chapter",
        templateName: input.templateName,
        title: input.title,
        segments: input.segments,
        roles: input.roles,
        fallbackNextHook: input.fallbackNextHook
      }
    );
    const parsed = response.parsed;
    const fallback = mockGenerateChapter(input);
    return {
      provider: "deepseek",
      model: response.model,
      status: "completed",
      usage: response.usage,
      title: asString(parsed.title, fallback.title),
      content: asString(parsed.content, fallback.content),
      nextHook: asString(parsed.nextHook, fallback.nextHook),
      highlights: asArray(parsed.highlights, fallback.highlights),
      keyChoices: asArray(parsed.keyChoices, fallback.keyChoices)
    };
  } catch (error) {
    const fallback = mockGenerateChapter(input, sanitizeError(error));
    fallback.errorCode = "deepseek_runtime_unavailable";
    fallback.errorMessage = sanitizeError(error);
    return fallback;
  }
}
