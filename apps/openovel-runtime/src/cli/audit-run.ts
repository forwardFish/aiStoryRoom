import path from "node:path";
import { readFile } from "node:fs/promises";
import { auditOpenNovelRun, type PlayerCheckpointReview } from "../audit.js";
import { runtimeRoot, workspacePaths } from "../paths.js";
import { writeJsonAtomic } from "../io.js";

const args = new Map(
  process.argv.slice(2).flatMap((value) => {
    const match = value.match(/^--([^=]+)=(.*)$/);
    return match ? [[match[1], match[2]]] : [];
  }),
);
const runId = String(args.get("run-id") || "").trim();
if (!runId) throw new Error("--run-id is required");
const targetTurns = Number(args.get("target-turns") || 5);
const root = path.resolve(args.get("root") || runtimeRoot());
const reviewsPath = String(args.get("reviews") || "").trim();
const reviews = reviewsPath
  ? JSON.parse(await readFile(path.resolve(reviewsPath), "utf8")) as PlayerCheckpointReview[]
  : [];
const inputPrice = args.has("input-price-per-million")
  ? Number(args.get("input-price-per-million"))
  : null;
const outputPrice = args.has("output-price-per-million")
  ? Number(args.get("output-price-per-million"))
  : null;
if ((inputPrice === null) !== (outputPrice === null)) {
  throw new Error("--input-price-per-million and --output-price-per-million must be provided together");
}
const pricing = inputPrice !== null || outputPrice !== null
  ? {
      inputPerMillion: Number(inputPrice),
      outputPerMillion: Number(outputPrice),
      currency: String(args.get("currency") || "CNY"),
    }
  : null;
const report = await auditOpenNovelRun(workspacePaths(root, runId), {
  targetTurns,
  reviews,
  pricing,
});
const output = String(args.get("output") || "").trim();
if (output) await writeJsonAtomic(path.resolve(output), report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
