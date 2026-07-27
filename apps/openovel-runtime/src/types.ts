export const OPENOVEL_RUNTIME_MODE = "OPENOVEL_V1" as const;

export type SoloRuntimeMode = "LEGACY_DETERMINISTIC" | typeof OPENOVEL_RUNTIME_MODE;

export type ModelMessage = {
  role: "system" | "user";
  content: string;
};

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ProviderResult = {
  text: string;
  model: string;
  requestId?: string;
  usage: ProviderUsage;
  latencyMs: number;
};

export type ProviderRequest = {
  profile: "narrator" | "options" | "storykeeper";
  messages: ModelMessage[];
  temperature: number;
  maxTokens: number;
  json: boolean;
  stream: boolean;
  onDelta?: (text: string) => void;
};

export interface OpenNovelProvider {
  generate(request: ProviderRequest): Promise<ProviderResult>;
  describe(): { provider: string; model: string; configured: boolean };
}

export type OpenNovelOptionEffect = {
  intent?: string;
  consequence?: string;
  stateHints?: Array<{
    key: string;
    op: "set" | "inc" | "dec" | "flag";
    value: unknown;
    note?: string;
  }>;
  risk?: "low" | "medium" | "high";
  difficulty?: string;
  reversible?: boolean;
};

export type OpenNovelOption = {
  id: string;
  label: string;
  key?: boolean;
  effect?: OpenNovelOptionEffect;
};

export type BoundOption = {
  id: string;
  label: string;
};

export type RunMetadata = {
  runId: string;
  worldId: string;
  roleId: string;
  runtimeMode: typeof OPENOVEL_RUNTIME_MODE;
  storyPackageVersion: string;
  openingVersion: string;
  upstreamCommit: string;
  packageVersion: string;
  createdAt: string;
  updatedAt: string;
  turnNumber: number;
  status: "READY" | "FOREGROUND_RUNNING" | "COMMITTING" | "FAILED";
  lastError?: string;
};

export type SceneEvent = {
  id: string;
  at: string;
  type: string;
  turnId?: string;
  [key: string]: unknown;
};

export type StorySnapshot = {
  metadata: RunMetadata;
  brief: string;
  foregroundGuidance: string;
  durableMemory: string;
  storyMemory: string;
  chapters: string;
  recentCanon: string;
  previousOptions: OpenNovelOption[];
  optionsGuidance: string;
};

export type CompiledForegroundContext = {
  foregroundGuidance: string;
  durableMemory: string;
  storyMemory: string;
  recentCanonExcerpt: string;
  report: {
    usedChars: number;
    budgets: Record<string, number>;
    truncated: string[];
  };
};

export type RuntimeWarning = {
  code: string;
  message: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  blocksPlayer: false;
};

export type TurnResult = {
  runId: string;
  turnId: string;
  turnNumber: number;
  narration: string;
  options: OpenNovelOption[];
  framing: string;
  tension: string;
  storyComplete: boolean;
  warnings: RuntimeWarning[];
  narrator: ProviderResult;
  optionsProvider?: ProviderResult;
  committedAt: string;
};

export type TurnEvent =
  | { type: "narration.delta"; data: { text: string } }
  | { type: "narration.complete"; data: { narration: string } }
  | { type: "options.complete"; data: { options: OpenNovelOption[]; framing: string; error?: string } }
  | { type: "runtime.warning"; data: RuntimeWarning }
  | { type: "turn.committed"; data: TurnResult };

export type MirrorEvent = {
  kind: "run.created" | "turn.committed" | "runtime.warning";
  runId: string;
  payload: unknown;
};

export interface EventMirror {
  publish(event: MirrorEvent): Promise<void>;
}

export type StorykeeperInboxItem = {
  id: string;
  turnId: string;
  action: string;
  narration: string;
  recentCanonBefore?: string;
  selectedEffect: OpenNovelOptionEffect | null;
  createdAt: string;
};
