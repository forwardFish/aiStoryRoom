import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const esmTempTsconfig = path.join(appRoot, ".tmp-pressure-narrative.esm.json");
const cjsTsconfig = path.join(appRoot, "tsconfig.pressure-narrative.cjs.json");
const tscBin = path.join(appRoot, "node_modules", "typescript", "bin", "tsc");
const esmOutDir = path.join(appRoot, "dist", "pressure-narrative");
const cjsOutDir = path.join(appRoot, "dist-cjs", "pressure-narrative");

async function main() {
  const esmConfig = {
    extends: "./tsconfig.json",
    compilerOptions: {
      outDir: "dist",
      rootDir: "src",
      declaration: true,
    },
    include: ["src/pressure-narrative/**/*.ts"],
  };

  await fs.rm(esmOutDir, { recursive: true, force: true });
  await fs.rm(cjsOutDir, { recursive: true, force: true });
  await fs.writeFile(
    esmTempTsconfig,
    `${JSON.stringify(esmConfig, null, 2)}\n`,
    "utf8",
  );

  try {
    runTsc(["-p", esmTempTsconfig]);
    runTsc(["-p", cjsTsconfig]);
    await fs.mkdir(cjsOutDir, { recursive: true });
    await fs.writeFile(
      path.join(cjsOutDir, "package.json"),
      `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
      "utf8",
    );
    await assertFile(path.join(esmOutDir, "index.js"));
    await assertFile(path.join(cjsOutDir, "index.js"));
  } finally {
    await fs.rm(esmTempTsconfig, { force: true });
  }
}

function runTsc(args) {
  execFileSync(process.execPath, [tscBin, ...args], {
    cwd: appRoot,
    stdio: "inherit",
  });
}

async function assertFile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Expected file was not emitted: ${filePath}`);
  }
}

await main();
