const upstreamOrigin = "https://appsapi-test.up.railway.app";

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    request.on("error", reject);
  });
}

export default async function handler(request, response) {
  try {
    const url = new URL(request.url || "/api", "https://ourmanyworlds.com");
    const headers = {};
    for (const [name, value] of Object.entries(request.headers || {})) {
      if (["host", "content-length", "connection"].includes(name.toLowerCase())) continue;
      headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    const method = String(request.method || "GET").toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request);
    const upstream = await fetch(`${upstreamOrigin}${url.pathname}${url.search}`, { method, headers, body });
    const payload = Buffer.from(await upstream.arrayBuffer());
    response.statusCode = upstream.status;
    upstream.headers.forEach((value, name) => {
      if (!["connection", "content-encoding", "content-length", "set-cookie"].includes(name.toLowerCase())) response.setHeader(name, value);
    });
    const cookies = typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : upstream.headers.get("set-cookie");
    if (cookies) response.setHeader("set-cookie", cookies);
    response.setHeader("content-length", payload.length);
    response.end(payload);
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ code: "API_PROXY_FAILED", message: error instanceof Error ? error.message : String(error) }));
  }
}
