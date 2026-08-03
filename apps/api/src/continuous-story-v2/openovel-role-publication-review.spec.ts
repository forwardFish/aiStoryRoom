import assert from "node:assert/strict";
import { acceptOpenNovelRolePublicationReview } from "./openovel-role-publication-review";

const lexicalReview = {
  status: "FAIL" as const,
  scores: { specificity: 1, causality: 1 },
  issues: [
    "ROLE_NOT_GROUNDED",
    "SCENE_NOT_GROUNDED",
    "CAUSAL_LINK_MISSING",
    "PLAYER_ACTION_NOT_REFLECTED",
  ],
};

const accepted = acceptOpenNovelRolePublicationReview(lexicalReview, true);
assert.equal(accepted.status, "PASS");
assert.ok(accepted.issues.every((issue) => issue.startsWith("SHADOW_LEGACY_LEXICAL:")));

const legacy = acceptOpenNovelRolePublicationReview(lexicalReview, false);
assert.equal(legacy.status, "FAIL", "legacy and structured-story publication behavior must not change");

const unsafe = acceptOpenNovelRolePublicationReview({
  ...lexicalReview,
  issues: [...lexicalReview.issues, "INTERNAL_ENGINE_TOKEN_LEAKED"],
}, true);
assert.equal(unsafe.status, "FAIL");
assert.ok(unsafe.issues.includes("INTERNAL_ENGINE_TOKEN_LEAKED"));

console.log("OpenNovel role publication review boundary: PASS");
