import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { assertPlayableMvpRole, getMvpStory, getMvpStoryRoles, listMvpStories } from "./mvp-catalog";

const catalog = listMvpStories();
assert.equal(catalog.featured.id, "sangtian");
assert.equal(catalog.sections.length, 2);
assert.ok(catalog.categories.includes("权谋历史"));
assert.equal(catalog.sections.flatMap((section) => section.stories).length, 8);

const story = getMvpStory("sangtian");
assert.equal(story.totalDays, 7);
assert.equal(story.roles.length, 5);
assert.equal(getMvpStoryRoles("sangtian")[0].key, "zhejiang_governor");
assert.equal(assertPlayableMvpRole("sangtian", "zhejiang_governor").playable, true);
assert.throws(() => assertPlayableMvpRole("sangtian", "xunfu"), BadRequestException);
assert.throws(() => getMvpStory("promotion-list"), BadRequestException);

console.log("MVP story catalog assertions passed");
