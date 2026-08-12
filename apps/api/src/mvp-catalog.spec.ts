import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { assertPlayableMvpRole, getMvpStory, getMvpStoryRoles, listMvpStories } from "./mvp-catalog";

const catalog = listMvpStories();
assert.equal(catalog.featured.id, "sangtian");
assert.equal(catalog.sections.length, 2);
assert.ok(catalog.categories.includes("权谋历史"));
assert.equal(catalog.sections.flatMap((section) => section.stories).length, 9);

const story = getMvpStory("sangtian");
assert.equal(story.totalDays, 7);
assert.equal(story.roles.length, 6);
assert.equal(story.roleSelectionBanner, "/assets/game/sangtian/background.png?v=efb61093");
assert.deepEqual(story.roles.map((role) => role.portrait), [
  "/assets/game/sangtian/generated/role-governor-scene-v1.png",
  "/assets/game/sangtian/generated/role-xunfu-scene-v1.png",
  "/assets/game/sangtian/generated/governor-scene-v1.png",
  "/assets/game/sangtian/generated/role-clerk-scene-v1.png",
  "/assets/game/sangtian/generated/role-merchant-scene-v1.png",
  "/assets/game/sangtian/generated/role-spy-scene-v1.png"
]);
assert.equal(getMvpStoryRoles("sangtian")[0].key, "zhejiang_governor");
assert.equal(story.roles.every((role) => role.publicGoal === role.tagline), true);
assert.equal(story.roles.every((role) => role.resources.length === 0), true);
assert.equal(story.roles.every((role) => !("personalGoal" in role)), true);
assert.equal(story.roles.every((role) => !("knownInfo" in role)), true);
assert.equal(story.roles.every((role) => !("gameplayProfile" in role)), true);
assert.deepEqual(story.roles.map((role) => role.name), [
  "浙江总督", "浙江巡抚", "清流县令", "改桑书吏", "江南商会会首", "司礼监织造使"
]);
assert.equal(story.roles.some((role) => /(?:rank|shield|treasury|grain|crown|magistrate|minister)\.png$/u.test(role.portrait)), false);
assert.equal(assertPlayableMvpRole("sangtian", "zhejiang_governor").playable, true);
const caesar = getMvpStory("caesar");
assert.equal(caesar.roles.length, 6);
assert.equal(caesar.roleSelectionBanner, "/assets/game/caesar/room-banner.png");
assert.equal(caesar.roles[0]?.portrait, "/assets/game/caesar/brutus.png");
assert.equal(assertPlayableMvpRole("caesar", "brutus").playable, true);
assert.equal(assertPlayableMvpRole("sangtian", "zhejiang_administration").playable, true);
assert.equal(assertPlayableMvpRole("sangtian", "jiangnan_merchant").playable, true);
assert.throws(() => assertPlayableMvpRole("sangtian", "clerk"), BadRequestException);
assert.throws(() => getMvpStory("promotion-list"), BadRequestException);

console.log("MVP story catalog assertions passed");
