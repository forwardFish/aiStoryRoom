// Keep this list aligned with the browser-side safeReturnTo contract. Protected
// pages such as My Account still need to survive Google authentication before
// their own authorization guards run.
const allowedExactPaths = new Set(["/", "/account", "/admin/refunds", "/join", "/rooms", "/game", "/game/result", "/credits", "/credits/status", "/credits/cancel", "/credits/failed", "/role-select", "/trio"]);

export function safeAuthReturnTo(value: string | undefined) {
  if (!value || value.includes("\\") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://manyworlds.invalid");
    if (url.origin !== "https://manyworlds.invalid" || !isAllowedPath(url.pathname)) return "/";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

function isAllowedPath(pathname: string) {
  return allowedExactPaths.has(pathname) || /^\/rooms\/[A-Za-z0-9_-]+$/.test(pathname) || /^\/worlds\/[A-Za-z0-9_-]+$/.test(pathname);
}
