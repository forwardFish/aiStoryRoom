import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("API bootstrap enables Nest shutdown hooks before listening", () => {
  const packagePath = resolve(process.cwd(), "src/main.ts");
  const source = readFileSync(
    existsSync(packagePath) ? packagePath : resolve(process.cwd(), "apps/api/src/main.ts"),
    "utf8",
  );
  const hooks = source.indexOf("app.enableShutdownHooks()");
  const listen = source.indexOf("await app.listen(");
  assert.ok(hooks >= 0, "shutdown hooks must be enabled");
  assert.ok(listen > hooks, "shutdown hooks must be installed before the server starts listening");
});

test("API bootstrap defaults Pressure worker ownership to embedded_api", () => {
  const source = readFileSync(resolve(process.cwd(), "apps/api/src/main.ts"), "utf8");
  assert.match(source, /PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1/);
  assert.match(source, /embedded_api/);
});

test("dedicated worker marks STORY_WORKER_PROCESS before Nest bootstraps", () => {
  const source = readFileSync(resolve(process.cwd(), "apps/api/src/worker.ts"), "utf8");
  const mark = source.indexOf('process.env.STORY_WORKER_PROCESS = "true";');
  const create = source.indexOf("createApplicationContext(AppModule");
  assert.ok(mark >= 0, "worker process role must be declared");
  assert.ok(create > mark, "worker process role must be declared before Nest bootstraps");
});
