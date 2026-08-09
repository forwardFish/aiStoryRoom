const params = new URLSearchParams(globalThis.location?.search || "");
const storyId = String(params.get("story") || "").trim();
const allowedRoles = new Set(
  String(params.get("soloRoles") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

if (storyId && allowedRoles.size && typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url = new URL(typeof input === "string" ? input : input.url, globalThis.location?.href || "http://localhost/");
    if (!response.ok || !url.pathname.endsWith(`/v4/worlds/${encodeURIComponent(storyId)}`)) return response;
    const payload = await response.clone().json().catch(() => null);
    if (!payload || !Array.isArray(payload.roles)) return response;
    const roles = payload.roles.filter((role) => allowedRoles.has(String(role?.key || "")));
    if (!roles.length) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify({ ...payload, roles }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
