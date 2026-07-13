import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(process.cwd(), "packages", "templates", "config", "sangtian");
const files = ["days.json", "decisions.json", "maneuvers.json", "leverage.json", "endings.json"];

async function load(name: string) {
  return JSON.parse(await readFile(join(root, name), "utf8"));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`SANGTIAN_CONFIG_INVALID: ${message}`);
}

async function main() {
  const [days, decisions, maneuvers, leverage, endings] = await Promise.all(files.map(load));
  assert(days.schemaVersion === "1.1" && decisions.schemaVersion === "1.1", "schemaVersion must be 1.1");
  assert(days.templateKey === "sangtian" && decisions.templateKey === "sangtian", "templateKey must be sangtian");
  assert(days.days?.length === 7, "exactly seven day definitions are required");
  for (const day of days.days) {
    if (day.day <= 6) {
      assert(day.decisionKeys?.length === 2, `day ${day.day} must have two decisions`);
      assert(day.maneuverKeys?.length === 4, `day ${day.day} must expose four maneuver types`);
    } else {
      assert(day.decisionKeys?.length === 0 && day.maneuverKeys?.length === 0, "day 7 must have no decisions or maneuvers");
    }
  }
  assert(decisions.decisions?.length === 12, "exactly twelve main decisions are required");
  assert(new Set(decisions.decisions.map((item: any) => item.key)).size === 12, "decision keys must be unique");
  assert(maneuvers.opportunitiesPerDay === 2 && maneuvers.maxSuccessfulManeuvers === 12, "maneuver quotas are invalid");
  assert(maneuvers.doesNotReplaceMainDecision && maneuvers.doesNotCarryOver, "maneuver semantics are invalid");
  assert(leverage.leverage?.length >= 3 && leverage.leverage.every((item: any) => item.singleUse), "leverage definitions are incomplete");
  assert(endings.globalEndings?.length >= 5 && endings.personalRanks?.length >= 5 && endings.ruleFirst && endings.aiOnlyNarrates, "ending definitions are incomplete");
  console.log(JSON.stringify({ status: "PASS", templateKey: "sangtian", days: 7, decisions: 12, maneuverTypes: maneuvers.types.length, globalEndings: endings.globalEndings.length, personalRanks: endings.personalRanks.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
