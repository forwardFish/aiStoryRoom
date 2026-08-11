import { isPressureGameProjection, pressureProjectionFromConfirmResponse } from "./sangtian-pressure-game.js";

export class PressureGameStorage {
  constructor({ roomId, initialProjection = null, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.roomId = String(roomId || "");
    this.initialProjection = initialProjection;
    this.fetchImpl = fetchImpl;
    this.initialConsumed = false;
    if (!this.roomId) throw new TypeError("PressureGameStorage requires roomId");
    if (typeof this.fetchImpl !== "function") throw new TypeError("PressureGameStorage requires fetchImpl");
  }

  get savedRunId() {
    return this.roomId;
  }

  async restoreOrCreate() {
    if (!this.initialConsumed && isPressureGameProjection(this.initialProjection)) {
      this.initialConsumed = true;
      return structuredClone(this.initialProjection);
    }
    return this.getRun();
  }

  async getRun() {
    return this.request(`/api/v4/rooms/${encodeURIComponent(this.roomId)}/game`);
  }

  async previewPressureAction(_projection, command) {
    return this.request(`/api/v4/rooms/${encodeURIComponent(this.roomId)}/game/actions/preview`, {
      method: "POST",
      body: JSON.stringify(command)
    });
  }

  async confirmPressureAction(_projection, command) {
    const response = await this.request(`/api/v4/rooms/${encodeURIComponent(this.roomId)}/game/actions/confirm`, {
      method: "POST",
      body: JSON.stringify(command)
    });
    if (!pressureProjectionFromConfirmResponse(response)) {
      throw clientError("INVALID_PRESSURE_CONFIRM_RESPONSE", 502, "服务端未返回有效的桑田诏投影。");
    }
    return response;
  }

  async acknowledgePressurePrologue(projection, command) {
    if (projection?.prologue?.status !== "AWAITING_ACK") return { accepted: true, gameProjection: projection };
    const response = await this.request(`/api/v4/rooms/${encodeURIComponent(this.roomId)}/game/prologue/acknowledge`, {
      method: "POST",
      body: JSON.stringify(command)
    });
    const next = pressureProjectionFromConfirmResponse(response);
    if (!next) throw clientError("INVALID_PRESSURE_PROLOGUE_RESPONSE", 502, "序章已确认，但服务端未返回 N1 投影。");
    return response;
  }

  async request(url, init = {}) {
    const response = await this.fetchImpl(url, {
      credentials: "include",
      headers: { "content-type": "application/json", ...(init.headers || {}) },
      ...init
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw clientError(String(body?.code || `HTTP_${response.status}`), response.status, String(body?.message || "请求失败。"), body);
    }
    if (!isPressureGameProjection(body) && !pressureProjectionFromConfirmResponse(body) && !body?.previewId) {
      throw clientError("INVALID_PRESSURE_RESPONSE", 502, "服务端返回了无法识别的桑田诏数据。", body);
    }
    return body;
  }
}

function clientError(code, status, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}
