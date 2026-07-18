import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";

test("same-origin API proxy forwards POST bodies without forbidden hop-by-hop headers", async () => {
  const source = await readFile(new URL("../../../api/proxy.js", import.meta.url), "utf8");
  const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const originalFetch = globalThis.fetch;
  const originalOrigin = process.env.MANY_WORLDS_API_ORIGIN;
  process.env.MANY_WORLDS_API_ORIGIN = "https://api.example.test";
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = { url: String(url), options };
    return new Response(JSON.stringify({ created: true }), { status: 201, headers: { "content-type": "application/json", "set-cookie": "many_worlds_session=opaque; HttpOnly; Path=/" } });
  };
  try {
    const request = new ProxyRequest("{}", {
      host: "ourmanyworlds.com",
      connection: "keep-alive",
      "content-length": "2",
      "transfer-encoding": "chunked",
      te: "trailers",
      "content-type": "application/json",
      "x-requested-with": "many-worlds-web"
    });
    const response = new ProxyResponse();
    await handler(request, response);
    assert.equal(forwarded.url, "https://api.example.test/api/v4/auth/google/challenge");
    assert.equal(forwarded.options.method, "POST");
    assert.equal(Buffer.from(forwarded.options.body).toString("utf8"), "{}");
    assert.equal(forwarded.options.headers["content-type"], "application/json");
    assert.equal(forwarded.options.headers["x-requested-with"], "many-worlds-web");
    for (const forbidden of ["host", "connection", "content-length", "transfer-encoding", "te"]) {
      assert.equal(forbidden in forwarded.options.headers, false, `${forbidden} must not be forwarded`);
    }
    assert.equal(response.statusCode, 201);
    assert.match(response.body.toString("utf8"), /"created":true/);
    assert.match(String(response.headers["set-cookie"]), /many_worlds_session=opaque/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOrigin === undefined) delete process.env.MANY_WORLDS_API_ORIGIN;
    else process.env.MANY_WORLDS_API_ORIGIN = originalOrigin;
  }
});

test("same-origin API proxy fails closed when its upstream is not configured", async () => {
  const source = await readFile(new URL("../../../api/proxy.js", import.meta.url), "utf8");
  const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#missing-origin`);
  const originalPrimary = process.env.MANY_WORLDS_API_ORIGIN;
  const originalFallback = process.env.API_UPSTREAM_ORIGIN;
  const originalFetch = globalThis.fetch;
  delete process.env.MANY_WORLDS_API_ORIGIN;
  delete process.env.API_UPSTREAM_ORIGIN;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("must not be called"); };
  try {
    const response = new ProxyResponse();
    await handler(new ProxyRequest("{}", { "content-type": "application/json" }), response);
    assert.equal(called, false);
    assert.equal(response.statusCode, 500);
    assert.match(response.body.toString("utf8"), /API_PROXY_CONFIG_INVALID/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPrimary === undefined) delete process.env.MANY_WORLDS_API_ORIGIN; else process.env.MANY_WORLDS_API_ORIGIN = originalPrimary;
    if (originalFallback === undefined) delete process.env.API_UPSTREAM_ORIGIN; else process.env.API_UPSTREAM_ORIGIN = originalFallback;
  }
});

class ProxyRequest extends Readable {
  method = "POST";
  url = "/api/proxy?path=v4/auth/google/challenge";
  constructor(body, headers) { super(); this.body = body; this.headers = headers; }
  _read() { this.push(Buffer.from(this.body)); this.push(null); }
}

class ProxyResponse extends EventEmitter {
  statusCode = 200;
  headers = {};
  body = Buffer.alloc(0);
  setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; }
  end(value) { if (value) this.body = Buffer.from(value); }
}
