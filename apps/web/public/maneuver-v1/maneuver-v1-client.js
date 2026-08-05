const JSON_HEADERS = Object.freeze({ accept: "application/json", "content-type": "application/json" });

export class ManeuverV1HttpError extends Error {
  constructor({ status, code, message, recoverable = false, payload = {} }) {
    super(message || code || `Maneuver request failed (${status})`);
    this.name = "ManeuverV1HttpError";
    this.status = Number(status) || 0;
    this.code = String(code || "MANEUVER_REQUEST_FAILED");
    this.recoverable = recoverable === true;
    this.payload = payload;
  }
}

export class ManeuverV1Client {
  constructor({ runId, fetchImpl }) {
    if (!runId) throw new TypeError("ManeuverV1Client requires runId");
    if (typeof fetchImpl !== "function") throw new TypeError("ManeuverV1Client requires fetchImpl");
    this.runId = String(runId);
    this.fetchImpl = fetchImpl;
    this.basePath = `/api/v4/rooms/${encodeURIComponent(this.runId)}/maneuvers`;
  }

  projection({ signal } = {}) {
    return this.#request(`${this.basePath}/projection`, { method: "GET", signal });
  }

  preview({ draft, expectedStateRevision, signal } = {}) {
    return this.#request(`${this.basePath}/preview`, {
      method: "POST",
      signal,
      body: JSON.stringify({ draft, expectedStateRevision }),
    });
  }

  commit({ previewToken, idempotencyKey, expectedStateRevision, signal } = {}) {
    return this.#request(`${this.basePath}/commit`, {
      method: "POST",
      signal,
      body: JSON.stringify({ previewToken, idempotencyKey, expectedStateRevision }),
    });
  }

  async #request(path, init) {
    const response = await this.fetchImpl(path, { credentials: "include", headers: JSON_HEADERS, ...init });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ManeuverV1HttpError({
        status: response.status,
        code: payload?.code,
        message: payload?.message,
        recoverable: payload?.recoverable,
        payload,
      });
    }
    return payload;
  }
}
