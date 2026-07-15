const params = new URLSearchParams(window.location.search);
const isLocalRuntime = location.hostname === "localhost" || location.hostname === "127.0.0.1";
// Production requests are same-origin through Vercel's `/api/*` rewrite. This
// lets Railway set first-party, HttpOnly session cookies for ourmanyworlds.com.
const deployedApiBase = "/api";
const apiBase = (params.get("apiBase") || (isLocalRuntime ? localStorage.getItem("many-worlds-api-base") || "/api" : deployedApiBase)).replace(/\/$/, "");
localStorage.setItem("many-worlds-api-base", apiBase);

export function getToken() { return document.cookie.split(";").some((item) => item.trim() === "many_worlds_session_hint=1") ? "cookie-session" : ""; }
export function setToken() { localStorage.removeItem("many-worlds-token"); }

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("content-type", "application/json");
  const response = await fetch(`${apiBase}${path}`, { ...options, credentials: "include", headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.code || `Request failed: ${response.status}`), { status: response.status, payload });
  return payload;
}
