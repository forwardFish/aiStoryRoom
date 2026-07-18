function resolveUpstreamOrigin(env = process.env) {
  const configured = String(env.MANY_WORLDS_API_ORIGIN || env.API_UPSTREAM_ORIGIN || "").trim();
  if (!configured) throw new Error("MANY_WORLDS_API_ORIGIN or API_UPSTREAM_ORIGIN is required");
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("API upstream origin must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("API upstream origin must be an HTTPS URL without credentials, query, or fragment");
  }
  return configured.replace(/\/+$/, "");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    request.on("error", reject);
  });
}

function forwardHeaders(upstream, response) {
  upstream.headers.forEach((value, name) => {
    if (!["connection", "content-encoding", "content-length", "set-cookie"].includes(name.toLowerCase())) response.setHeader(name, value);
  });
  const cookies = typeof upstream.headers.getSetCookie === "function"
    ? upstream.headers.getSetCookie()
    : upstream.headers.get("set-cookie");
  if (cookies) response.setHeader("set-cookie", cookies);
}

async function pipeStreamingBody(upstream, response) {
  response.setHeader("cache-control", "no-cache, no-transform");
  response.setHeader("x-accel-buffering", "no");
  response.flushHeaders?.();
  if (!upstream.body) {
    response.end();
    return;
  }
  for await (const chunk of upstream.body) {
    if (response.destroyed || response.writableEnded) break;
    response.write(Buffer.from(chunk));
  }
  if (!response.writableEnded) response.end();
}

export default async function handler(request, response) {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  request.once?.("aborted", cancel);
  response.once?.("close", cancel);
  try {
    const url = new URL(request.url || "/api/proxy", "https://ourmanyworlds.com");
    const path = String(url.searchParams.get("path") || "").replace(/^\/+/, "");
    if (!path || path.includes("..")) {
      response.statusCode = 400;
      response.end(JSON.stringify({ code: "API_PROXY_PATH_REQUIRED" }));
      return;
    }
    let upstreamOrigin;
    try {
      upstreamOrigin = resolveUpstreamOrigin();
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ code: "API_PROXY_CONFIG_INVALID", message: error instanceof Error ? error.message : String(error) }));
      return;
    }
    url.searchParams.delete("path");
    const headers = {};
    const hopByHopHeaders = new Set(["connection", "content-length", "expect", "host", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
    for (const [name, value] of Object.entries(request.headers || {})) {
      if (hopByHopHeaders.has(name.toLowerCase())) continue;
      headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    const method = String(request.method || "GET").toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request);
    const upstream = await fetch(`${upstreamOrigin}/api/${path}${url.search}`, { method, headers, body, signal: abort.signal });
    response.statusCode = upstream.status;
    forwardHeaders(upstream, response);
    const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/event-stream")) {
      await pipeStreamingBody(upstream, response);
      return;
    }
    const payload = Buffer.from(await upstream.arrayBuffer());
    response.setHeader("content-length", payload.length);
    response.end(payload);
  } catch (error) {
    if (response.headersSent || response.writableEnded) {
      if (!response.writableEnded) response.end();
      return;
    }
    response.statusCode = 502;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ code: "API_PROXY_FAILED", message: error instanceof Error ? error.message : String(error) }));
  } finally {
    request.removeListener?.("aborted", cancel);
    response.removeListener?.("close", cancel);
  }
}
