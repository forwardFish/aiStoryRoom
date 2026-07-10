const RUN_ID_KEY = "ai-story-room:sangtian:run-id";

export class StoryApiError extends Error {
  constructor(message, { status = 0, code = "API_ERROR", details = null } = {}) {
    super(message);
    this.name = "StoryApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * The browser's only story state adapter.
 *
 * It deliberately stores just the current run id. Story state, causal state and
 * final judgement always come from /api/v4; there is no local game-engine
 * fallback that can drift away from the server.
 */
export class ApiStoryStorage {
  constructor({ baseUrl, fetchImpl = globalThis.fetch, localStorage = globalThis.localStorage } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("ApiStoryStorage requires fetch");
    this.baseUrl = String(baseUrl || "/api").replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.localStorage = localStorage;
  }

  get savedRunId() {
    return this.localStorage?.getItem(RUN_ID_KEY) || "";
  }

  forgetRun() {
    this.localStorage?.removeItem(RUN_ID_KEY);
  }

  async restoreOrCreate() {
    const runId = this.savedRunId;
    if (!runId) return this.createRun();

    try {
      return await this.getRun(runId);
    } catch (error) {
      if (error instanceof StoryApiError && error.status === 404) {
        throw new StoryApiError("原故事局已不存在，无法恢复。请确认后点击“重开”创建新局。", {
          status: 404,
          code: "RUN_NOT_FOUND",
          details: error.details
        });
      }
      throw error;
    }
  }

  async createRun() {
    const view = await this.request("/v4/story-runs", {
      method: "POST",
      body: { storyId: "sangtian" }
    });
    this.assertView(view);
    this.localStorage?.setItem(RUN_ID_KEY, view.run.id);
    return view;
  }

  async getRun(runId = this.savedRunId) {
    if (!runId) throw new StoryApiError("没有可恢复的故事局。", { code: "RUN_ID_MISSING" });
    const view = await this.request(`/v4/story-runs/${encodeURIComponent(runId)}`);
    this.assertView(view);
    this.localStorage?.setItem(RUN_ID_KEY, view.run.id);
    return view;
  }

  async submitDecision(view, { messageId, optionKey, customText = "" }) {
    this.assertView(view);
    const payload = await this.request(
      `/v4/story-runs/${encodeURIComponent(view.run.id)}/messages/${encodeURIComponent(messageId)}/decisions`,
      {
        method: "POST",
        body: {
          optionKey,
          customText: optionKey === "CUSTOM" ? customText : "",
          version: view.run.version
        }
      }
    );
    // ActionGuard rejections are a valid protocol response, not a broken view.
    if (payload?.accepted === false) return payload;
    this.assertView(payload);
    return payload;
  }

  async advanceDay(view) {
    this.assertView(view);
    const nextView = await this.request(`/v4/story-runs/${encodeURIComponent(view.run.id)}/advance-day`, {
      method: "POST",
      body: { version: view.run.version }
    });
    this.assertView(nextView);
    return nextView;
  }

  async finalize(view) {
    this.assertView(view);
    const finalView = await this.request(`/v4/story-runs/${encodeURIComponent(view.run.id)}/finalize`, {
      method: "POST",
      body: { version: view.run.version }
    });
    this.assertView(finalView);
    return finalView;
  }

  async request(path, { method = "GET", body } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new StoryApiError("无法连接剧情服务，请确认服务已启动后重试。", {
        code: "NETWORK_ERROR",
        details: error instanceof Error ? error.message : String(error)
      });
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const nestedPayload = payload?.message && typeof payload.message === "object" ? payload.message : null;
      const nestedMessage = nestedPayload?.message || "";
      const serverMessage = (typeof payload?.message === "string" ? payload.message : nestedMessage) || payload?.reason;
      throw new StoryApiError(serverMessage || `剧情服务请求失败（HTTP ${response.status}）。`, {
        status: response.status,
        code: payload?.code || nestedPayload?.code || "HTTP_ERROR",
        details: payload
      });
    }
    if (!payload || typeof payload !== "object") {
      throw new StoryApiError("剧情服务返回了无法识别的数据。", { status: response.status, code: "INVALID_RESPONSE" });
    }
    return payload;
  }

  assertView(view) {
    const run = view?.run;
    const dashboardIsObject = view?.dashboard !== null && typeof view?.dashboard === "object" && !Array.isArray(view.dashboard);
    const hasValidRun = run?.id
      && Number.isInteger(Number(run.currentDay))
      && Number.isInteger(Number(run.version))
      && typeof run.status === "string"
      && run.status.length > 0;
    const hasFinishedJudgement = run?.status !== "finished"
      || (view.finalJudgement !== null && typeof view.finalJudgement === "object" && !Array.isArray(view.finalJudgement));
    if (!hasValidRun || !dashboardIsObject || !Array.isArray(view.messages) || !hasFinishedJudgement) {
      throw new StoryApiError("剧情服务返回的 StoryRun 不完整。", { code: "INVALID_STORY_VIEW" });
    }
  }
}

export function defaultApiBase(location = globalThis.location) {
  if (!location) return "/api";
  // Local validation cabin and API intentionally run on separate ports.
  if (location.port === "5177") return `${location.protocol}//${location.hostname}:3001/api`;
  return "/api";
}

export const storyRunStorageKey = RUN_ID_KEY;
