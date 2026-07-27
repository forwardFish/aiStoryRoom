import assert from "node:assert/strict";
import test from "node:test";
import type { NarrativeTextureAllowance } from "@ai-story/templates";
import {
  findExplicitUnauthorizedObjectManipulation,
  isAuthorizedIncidentalCreationTexture
} from "../narrative-causality-boundary";

const secondWorldAllowance: NarrativeTextureAllowance = {
  allowanceId: "TEXTURE-CREATE-DOCUMENT-CIPHER-CABLE",
  textureClass: "CREATION_SUBSTRATE",
  lifecycle: "CONSUMED_INTO_TARGET",
  targetEntityKind: "DOCUMENT",
  targetEntityRef: "document.cipher_cable",
  targetEntityLabel: "加密电报"
};

test("a second-world story may consume ordinary writing material into an authorized entity", () => {
  assert.equal(
    isAuthorizedIncidentalCreationTexture(
      "她抽出一张纸，伏案写成加密电报，随即交给报务员。",
      [secondWorldAllowance]
    ),
    true
  );
});

test("ordinary material is not texture when it becomes a second causal artifact", () => {
  assert.equal(
    isAuthorizedIncidentalCreationTexture(
      "她抽出一张纸写成加密电报，又另留一份副本作为证据。",
      [secondWorldAllowance]
    ),
    false
  );
});

test("ordinary material cannot create a different unauthorized entity", () => {
  assert.equal(
    isAuthorizedIncidentalCreationTexture(
      "她抽出一张纸，伏案写成接头名单。",
      [secondWorldAllowance]
    ),
    false
  );
});

const secondWorldActors = [
  { actorRef: "actor.station_director", aliases: ["空间站主任", "主任"] },
  { actorRef: "actor.security_officer", aliases: ["安保官"] }
] as const;

test("a gaze moving to a durable object remains L0 texture in a second world", () => {
  assert.equal(
    findExplicitUnauthorizedObjectManipulation({
      prose: "安保官把目光从主任脸上移到那枚已经封好的数据芯片上。",
      objectLabels: ["数据芯片"],
      authorizedHolderRef: "actor.security_officer",
      actors: secondWorldActors
    }),
    null
  );
});

test("an explicit non-holder manipulation is a durable causal assertion in a second world", () => {
  assert.deepEqual(
    findExplicitUnauthorizedObjectManipulation({
      prose: "空间站主任拿过数据芯片，放进自己的制服口袋。",
      objectLabels: ["数据芯片"],
      authorizedHolderRef: "actor.security_officer",
      actors: secondWorldActors
    }),
    {
      actorRef: "actor.station_director",
      fragment: "空间站主任拿过数据芯片",
      level: "L2_DURABLE_ENTITY",
      predicate: "OBJECT_MANIPULATION"
    }
  );
});

test("reported or negated object manipulation does not become a committed causal fact", () => {
  assert.equal(
    findExplicitUnauthorizedObjectManipulation({
      prose: "安保官说：“主任若拿走数据芯片，封存链就断了。”主任没有碰那枚数据芯片。",
      objectLabels: ["数据芯片"],
      authorizedHolderRef: "actor.security_officer",
      actors: secondWorldActors
    }),
    null
  );
});
