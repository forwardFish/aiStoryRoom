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
assert.equal(story.roleSelectionBanner, "/assets/game/sangtian/background.png");
assert.deepEqual(story.roles.map((role) => role.portrait), [
  "/assets/game/sangtian/generated/role-governor-scene-v1.png",
  "/assets/game/sangtian/generated/role-xunfu-scene-v1.png",
  "/assets/game/sangtian/generated/governor-scene-v1.png",
  "/assets/game/sangtian/generated/role-clerk-scene-v1.png",
  "/assets/game/sangtian/generated/role-merchant-scene-v1.png",
  "/assets/game/sangtian/generated/role-spy-scene-v1.png"
]);
assert.equal(getMvpStoryRoles("sangtian")[0].key, "zhejiang_governor");
assert.equal(assertPlayableMvpRole("sangtian", "zhejiang_governor").playable, true);
const caesar = getMvpStory("caesar");
assert.equal(caesar.roles.length, 6);
assert.equal(caesar.roleSelectionBanner, "/assets/game/caesar/room-banner.png");
assert.equal(caesar.roles[0]?.portrait, "/assets/game/caesar/brutus.png");
assert.equal(assertPlayableMvpRole("caesar", "brutus").playable, true);
assert.equal(assertPlayableMvpRole("sangtian", "xunfu").playable, true);
assert.equal(assertPlayableMvpRole("sangtian", "merchant").playable, true);
assert.throws(() => getMvpStory("promotion-list"), BadRequestException);

console.log("MVP story catalog assertions passed");
