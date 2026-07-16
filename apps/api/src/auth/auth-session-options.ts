export function authSessionTtlSeconds() {
  const configured = Number(process.env.AUTH_SESSION_TTL_DAYS || 30);
  const days = Number.isFinite(configured) ? Math.min(90, Math.max(1, Math.floor(configured))) : 30;
  return days * 24 * 60 * 60;
}

export function authCookieSecure() {
  const configured = String(process.env.AUTH_COOKIE_SECURE || "").trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  // Railway can run a production deployment without exporting NODE_ENV. The
  // public HTTPS origin is therefore also authoritative for the cookie flag.
  if (process.env.NODE_ENV === "production") return true;
  try { return new URL(String(process.env.PUBLIC_WEB_URL || "")).protocol === "https:"; }
  catch { return false; }
}
