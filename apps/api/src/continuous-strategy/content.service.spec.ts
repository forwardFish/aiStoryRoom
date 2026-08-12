import assert from "node:assert/strict";
import { getGameDefinition } from "@ai-story/templates";
import { ContinuousStrategyContentService } from "./content.service";

const service = new ContinuousStrategyContentService();
assert.equal(getGameDefinition("sangtian").engine.engineVersion, "pressure_chapter_v1");
const first = service.package("sangtian", "sangtian_v1_2");
const second = service.package("sangtian", "sangtian_v1_2");
assert.equal(first, second);
assert.equal(first.contract.worldId, "sangtian");
assert.deepEqual(first.contract.playableRoleKeys, ["zhejiang_governor", "xunfu", "county_magistrate", "clerk", "merchant", "sili_jian"]);

const bound = service.forGame("sangtian", "sangtian_v1_2");
assert.equal(bound.stage(1).stageNumber, 1);
assert.equal(bound.isPlayableRoleKey("xunfu"), true);
assert.equal(bound.isPlayableRoleKey("merchant"), true);
const v11 = service.package("sangtian", "sangtian_v1_1");
assert.deepEqual(v11.contract.playableRoleKeys, ["zhejiang_governor", "xunfu", "county_magistrate"]);
assert.equal(v11.contract.worldActorKey, "merchant");
assert.throws(() => service.package("caesar", "legacy_v1"), /GAME_ENGINE_NOT_CONTINUOUS/);

console.log("continuous strategy multi-game content cache contracts: PASS");
