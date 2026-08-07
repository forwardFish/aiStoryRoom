#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateSpec } from "../lib/spec.mjs";
import { generateVideoKit } from "../lib/render.mjs";
export { buildScenes, validateSpec } from "../lib/spec.mjs";
export { generateVideoKit, renderFrameSvg } from "../lib/render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(file) { return JSON.parse(await readFile(file,"utf8")); }
async function jsonFiles(target) {
  const absolute = path.resolve(target);
  const info = await stat(absolute);
  if (info.isFile()) return absolute.endsWith(".json") ? [absolute] : [];
  return (await readdir(absolute,{withFileTypes:true})).filter((entry)=>entry.isFile()&&entry.name.endsWith(".json")).map((entry)=>path.join(absolute,entry.name)).sort();
}
async function validateTarget(target, options={}) {
  let failures = 0;
  for (const file of await jsonFiles(target)) {
    const spec = await readJson(file);
    const result = validateSpec(spec,{...options,source:file});
    console.log(`\n${path.relative(process.cwd(),file)}`);
    result.warnings.forEach((item)=>console.log(`  WARN: ${item}`));
    result.errors.forEach((item)=>console.log(`  ERROR: ${item}`));
    if (!result.errors.length) console.log(`  PASS: ${spec.videoId} (${spec.format.durationSeconds}s)`);
    failures += result.errors.length;
  }
  if (failures) throw new Error(`${failures} validation error(s) found.`);
}
async function batch(input, output) {
  for (const file of await jsonFiles(input)) {
    const spec = await readJson(file);
    const target = path.resolve(output,spec.videoId);
    const result = await generateVideoKit(spec,target);
    console.log(`GENERATED ${spec.videoId}: ${result.files.length} files -> ${target}`);
  }
}
async function main(args=process.argv.slice(2)) {
  const [command,...rest]=args;
  if (!command||["help","--help","-h"].includes(command)) return console.log("Usage:\n  node scripts/video-kit.mjs validate <spec-or-dir> [--strict-assets]\n  node scripts/video-kit.mjs generate <spec> <output>\n  node scripts/video-kit.mjs batch <spec-dir> <output-root>");
  if (command==="validate") return validateTarget(rest.find((item)=>!item.startsWith("--")),{strictAssets:rest.includes("--strict-assets"),assetBaseDir:ROOT});
  if (command==="generate") return generateVideoKit(await readJson(path.resolve(rest[0])),path.resolve(rest[1])).then((result)=>console.log(`GENERATED: ${result.files.length} files`));
  if (command==="batch") return batch(rest[0],rest[1]);
  throw new Error(`Unknown command: ${command}`);
}
if (path.resolve(process.argv[1]??"")===fileURLToPath(import.meta.url)) main().catch((error)=>{console.error(error.stack??error.message);process.exitCode=1;});
