import { StoryApiError } from "./api-story-storage.js?v=20260721-story-access-error-v4";
import { isPressureGameProjection, validatePressureGameProjection } from "./sangtian-pressure-game.js";

export class PressureGameStorage {
  constructor({ roomId, initialProjection = null, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    if (!String(roomId || "").trim()) throw new TypeError("PressureGameStorage requires a room id");
    if (typeof fetchImpl !== "function") throw new TypeError("PressureGameStorage requires fetch");
    this.roomId = String(roomId).trim();
    this.initialProjection = initialProjection;
    this.fetchImpl = fetchImpl;
  }

  get savedRunId() {
    return this.roomId;
  }

  async restoreOrCreate() {
    if (this.initialProjection) {
      const projection = this.initialProjection;
      this.initialProjection = null;
      this.assertProjection(projection);
      return projection;
    }
    return this.getRun();
  }

  async getRun() {
    const projection = await this.request(this.gamePath());
    this.assertProjection(projection);
    return projection;
  }

  async previewPressureAction(_projection, command) {
    return this.request(`${this.gamePath()}/actions/preview`, {
      method: "POST",
      body: command
    });
  }

  async confirmPressureAction(_projection, command) {
    const response = await this.request(`${this.gamePath()}/actions/confirm`, {
      method: "POST",
      body: command
    });
    const projection = pressureProjectionFromResponse(response);
    if (!projection) {
      throw new StoryApiError("确认行动后服务端没有返回 viewer projection。", {
        code: "INVALID_PRESSURE_CONFIRM_RESPONSE",
        details: response
      });
    }
    this.assertProjection(projection);
    return response;
  }

  async request(path, { method = "GET", body } = {}) {
    let response;
    try {
      response = await this.fetchImpl(path, {
        method,
        credentials: "include",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new StoryApiError("无法连接桑田诏运行时，请稍后重试。", {
        code: "NETWORK_ERROR",
        details: error instanceof Error ? error.message : String(error)
      });
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const nested = payload?.message && typeof payload.message === "object" ? payload.message : null;
      throw new StoryApiError(
        (typeof payload?.message === "string" ? payload.message : nested?.message) || payload?.reason || `桑田诏运行时请求失败（HTTP ${response.status}）。`,
        {
          status: response.status,
          code: payload?.code || nested?.code || "HTTP_ERROR",
          details: payload
        }
      );
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new StoryApiError("桑田诏运行时返回了无法识别的数据。", {
        status: response.status,
        code: "INVALID_RESPONSE"
      });
    }
    return payload;
  }

  assertProjection(projection) {
    const errors = validatePressureGameProjection(projection);
    if (!isPressureGameProjection(projection) || errors.length) {
      throw new StoryApiError("桑田诏运行时返回的 viewer projection 不完整。", {
        code: "INVALID_PRESSURE_PROJECTION",
        details: errors
      });
    }
  }

  gamePath() {
    return `/api/v4/rooms/${encodeURIComponent(this.roomId)}/game`;
  }
}

function pressureProjectionFromResponse(response) {
  if (isPressureGameProjection(response)) return response;
  for (const candidate of [response?.projection, response?.game, response?.viewerProjection]) {
    if (isPressureGameProjection(candidate)) return candidate;
  }
  return null;
}
