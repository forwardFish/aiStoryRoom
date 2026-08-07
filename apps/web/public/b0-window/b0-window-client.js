const JSON_HEADERS = Object.freeze({ accept: "application/json", "content-type": "application/json" });

export class B0WindowHttpError extends Error {
  constructor({ status, code, message, recoverable = false, payload = {} }) {
    super(message || code || `B0 window request failed (${status})`);
    this.name = "B0WindowHttpError";
    this.status = Number(status) || 0;
    this.code = String(code || "B0_WINDOW_REQUEST_FAILED");
    this.recoverable = recoverable === true;
    this.payload = payload;
  }
}

export class B0WindowClient {
  constructor({ runId, fetchImpl }) {
    if (!runId) throw new TypeError("B0WindowClient requires runId");
    if (typeof fetchImpl !== "function") throw new TypeError("B0WindowClient requires fetchImpl");
    this.runId = String(runId);
    this.fetchImpl = fetchImpl;
    this.basePath = `/api/v4/rooms/${encodeURIComponent(this.runId)}/b0/window`;
  }

  projection({ signal } = {}) {
    return this.#request(this.basePath, { method: "GET", signal });
  }

  preview({ draft, expectedStateRevision, expectedRevision, clientRequestId, signal } = {}) {
    return this.#request(`${this.basePath}/preview`, {
      method: "POST",
      signal,
      body: JSON.stringify({ draft, expectedStateRevision, expectedRevision, clientRequestId }),
    });
  }

  confirm({ expectedRevision, signal } = {}) {
    return this.#request(`${this.basePath}/confirm`, {
      method: "POST",
      signal,
      body: JSON.stringify({ expectedRevision }),
    });
  }

  ready({ expectedReadyRevision, hold = false, signal } = {}) {
    return this.#request(`${this.basePath}/ready`, {
      method: "POST",
      signal,
      body: JSON.stringify({ expectedReadyRevision, ...(hold ? { hold: true } : {}) }),
    });
  }

  unready({ expectedReadyRevision, signal } = {}) {
    return this.#request(`${this.basePath}/ready`, {
      method: "DELETE",
      signal,
      body: JSON.stringify({ expectedReadyRevision }),
    });
  }

  async #request(path, init) {
    const response = await this.fetchImpl(path, { credentials: "include", headers: JSON_HEADERS, ...init });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new B0WindowHttpError({
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
