const params = new URLSearchParams(window.location.search);
const apiBase = (params.get("apiBase") || localStorage.getItem("many-worlds-api-base") || (location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "http://localhost:3001/api" : "")).replace(/\/$/, "");
localStorage.setItem("many-worlds-api-base", apiBase);

export function getToken() { return localStorage.getItem("many-worlds-token") || ""; }
export function setToken(token) { if (token) localStorage.setItem("many-worlds-token", token); }

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.code || `Request failed: ${response.status}`), { status: response.status, payload });
  return payload;
}
