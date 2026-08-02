import { spawn as nodeSpawn } from "node:child_process";

export function buildPnpmInvocation(args, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const npmExecPath = env.npm_execpath;
  if (npmExecPath && /\.(?:cjs|mjs|js)$/i.test(npmExecPath)) {
    return { command: execPath, args: [npmExecPath, ...args] };
  }
  if (platform === "win32") {
    throw new Error("Windows gate requires npm_execpath; launch it through pnpm");
  }
  return { command: "pnpm", args };
}

export async function runPnpm(args, options = {}) {
  const invocation = buildPnpmInvocation(args, options);
  const spawn = options.spawn ?? nodeSpawn;
  const child = spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (!options.quiet) process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    if (!options.quiet) process.stderr.write(chunk);
  });
  const exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  return { ...invocation, exitCode, output };
}
