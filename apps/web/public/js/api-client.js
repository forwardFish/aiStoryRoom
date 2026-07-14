const params = new URLSearchParams(window.location.search);
const isLocalRuntime = location.hostname === "localhost" || location.hostname === "127.0.0.1";
// Vercel serves static pages and has no API proxy in production.  Keep the
// local same-origin proxy for development, while every deployed page uses the
// documented API origin unless an explicit preview/test override is supplied.
const apiBase = (params.get("apiBase") || localStorage.getItem("many-worlds-api-base") || (isLocalRuntime ? "/api" : "https://api.ourmanyworlds.com/api")).replace(/\/$/, "");
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
