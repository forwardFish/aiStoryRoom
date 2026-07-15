export function authSessionTtlSeconds() {
  const configured = Number(process.env.AUTH_SESSION_TTL_DAYS || 30);
  const days = Number.isFinite(configured) ? Math.min(90, Math.max(1, Math.floor(configured))) : 30;
  return days * 24 * 60 * 60;
}

export function authCookieSecure() {
  // Local development is normally plain HTTP. Production always uses HTTPS
  // behind Railway/Vercel, where Secure prevents the browser from exposing a
  // session cookie over an insecure connection.
  return process.env.NODE_ENV === "production";
}
