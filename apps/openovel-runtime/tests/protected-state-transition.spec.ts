import assert from "node:assert/strict";
import test from "node:test";
import {
  compileEstablishedScenePredicates,
  compileProtectedSceneTransition,
  selectProtectedTransitionSurface,
} from "../src/protected-state-transition.js";

test("typed established scene facts are reusable across worlds without prose matching", () => {
  const predicates = compileEstablishedScenePredicates({
    sceneRef: "bridge",
    presentActorRefs: ["actor.captain", "actor.navigator"],
    documents: [{
      entityRef: "manifest.departure",
      label: "departure manifest",
      status: "WRITTEN",
      holderRef: "actor.navigator",
    }],
    objects: [{
      entityRef: "relay.cylinder",
      label: "relay cylinder",
      holderRef: "actor.captain",
    }],
  });
  assert.deepEqual(predicates, [
    { type: "ENTITY.LOCATED_AT", entityId: "actor.captain", locationId: "location:bridge" },
    { type: "ENTITY.LOCATED_AT", entityId: "actor.navigator", locationId: "location:bridge" },
    {
      type: "ENTITY.STATE",
      entityId: "manifest.departure",
      attribute: "status",
      value: "WRITTEN",
    },
    { type: "DOCUMENT.CREATED", documentId: "manifest.departure" },
    { type: "ENTITY.HELD_BY", entityId: "manifest.departure", actorId: "actor.navigator" },
    { type: "ENTITY.HELD_BY", entityId: "relay.cylinder", actorId: "actor.captain" },
  ]);
});

test("typed Sangtian state transitions compile every consequential document and container fact", () => {
  const result = compileProtectedSceneTransition({
    before: {
      documents: [{
        entityRef: "document.reform_execution_record",
        label: "改桑放行回文",
        status: "NOT_PRESENT",
        holderRef: null,
      }],
      objects: [{
        entityRef: "object.xunfu_reply_box",
        label: "巡抚回文匣",
        contentsState: "EMPTY",
        closureState: "OPEN",
        holderRef: "actor.xunfu_clerk",
      }],
    },
    after: {
      documents: [{
        entityRef: "document.reform_execution_record",
        label: "改桑放行回文",
        status: "WRITTEN",
        holderRef: "actor.xunfu_clerk",
      }],
      objects: [{
        entityRef: "object.xunfu_reply_box",
        label: "巡抚回文匣",
        contentsState: "CONTAINS_DOCUMENT",
        closureState: "CLOSED",
        holderRef: "actor.xunfu_clerk",
      }],
    },
    actorLabel: (actorRef) => actorRef === "actor.xunfu_clerk" ? "巡抚书吏" : actorRef,
    locale: "zh-CN",
  });

  assert.match(result.text, /写成的改桑放行回文随即交由巡抚书吏持有/u);
  assert.match(result.text, /巡抚书吏将这份文书收入巡抚回文匣/u);
  assert.match(result.text, /将巡抚回文匣重新合拢/u);
  assert.deepEqual(result.sourceRefs, [
    "document:document.reform_execution_record:status",
    "document:document.reform_execution_record:holder",
    "object:object.xunfu_reply_box:contents",
    "object:object.xunfu_reply_box:closure",
  ]);
});

test("the same compiler preserves a second world's typed cargo transition without story-specific rules", () => {
  const result = compileProtectedSceneTransition({
    before: {
      documents: [{
        entityRef: "manifest.station.departure",
        label: "departure manifest",
        status: "DRAFT",
        holderRef: "actor.captain",
      }],
      objects: [{
        entityRef: "locker.flight.records",
        label: "flight-records locker",
        contentsState: "EMPTY",
        closureState: "OPEN",
        holderRef: "actor.navigator",
      }],
    },
    after: {
      documents: [{
        entityRef: "manifest.station.departure",
        label: "departure manifest",
        status: "WRITTEN",
        holderRef: "actor.navigator",
      }],
      objects: [{
        entityRef: "locker.flight.records",
        label: "flight-records locker",
        contentsState: "CONTAINS_DOCUMENT",
        closureState: "CLOSED",
        holderRef: "actor.navigator",
      }],
    },
    actorLabel: (actorRef) => actorRef === "actor.navigator" ? "the navigator" : "the captain",
    locale: "en-US",
  });

  assert.match(result.text, /completed departure manifest passed into the custody of the navigator/i);
  assert.match(result.text, /the navigator placed the document inside flight-records locker and closed flight-records locker again/i);
});

test("unchanged scene state produces no protected transition prose", () => {
  const state = {
    documents: [{ entityRef: "document.one", label: "document", status: "WRITTEN", holderRef: "actor.one" }],
    objects: [{ entityRef: "object.one", label: "box", contentsState: "EMPTY", closureState: "CLOSED", holderRef: "actor.one" }],
  };
  assert.deepEqual(compileProtectedSceneTransition({
    before: state,
    after: state,
    actorLabel: (actorRef) => actorRef,
  }), { text: "", sourceRefs: [] });
});

test("typed scene cuts protect destination time, location, and authorized arrivals", () => {
  const result = compileProtectedSceneTransition({
    before: {
      sceneRef: "scene.inner-hall",
      timeLabel: "初八辰时",
      locationLabel: "总督府内厅",
      presentActorRefs: ["actor.governor", "actor.clerk"],
      documents: [],
      objects: [],
    },
    after: {
      sceneRef: "scene.signing-room",
      timeLabel: "初九巳时",
      locationLabel: "总督府签押房",
      presentActorRefs: ["actor.governor", "actor.magistrate", "actor.aide"],
      documents: [],
      objects: [],
    },
    actorLabel: (actorRef) => ({
      "actor.governor": "总督",
      "actor.clerk": "书吏",
      "actor.magistrate": "县令",
      "actor.aide": "幕僚",
    })[actorRef] || actorRef,
    locale: "zh-CN",
  });

  assert.equal(result.text, "到了初九巳时，县令和幕僚已经在总督府签押房候着。");
  assert.deepEqual(result.sourceRefs, [
    "scene:identity",
    "scene:actor:actor.magistrate:present",
    "scene:actor:actor.aide:present",
  ]);
});

test("the same scene-cut compiler works for an unrelated English world", () => {
  const result = compileProtectedSceneTransition({
    before: {
      sceneRef: "deck",
      timeLabel: "night watch",
      locationLabel: "observation deck",
      presentActorRefs: ["actor.captain"],
      documents: [],
      objects: [],
    },
    after: {
      sceneRef: "bridge",
      timeLabel: "first light",
      locationLabel: "command bridge",
      presentActorRefs: ["actor.captain", "actor.navigator", "actor.engineer"],
      documents: [],
      objects: [],
    },
    actorLabel: (actorRef) => ({
      "actor.navigator": "the navigator",
      "actor.engineer": "the engineer",
    })[actorRef] || actorRef,
    locale: "en-US",
  });

  assert.equal(
    result.text,
    "By first light, the navigator and the engineer were waiting in command bridge.",
  );
});

test("a second world keeps its authored natural beat while typed transition refs remain auditable", () => {
  const compiled = compileProtectedSceneTransition({
    before: {
      documents: [],
      objects: [{
        entityRef: "relay.cylinder",
        label: "relay cylinder",
        holderRef: "actor.captain",
      }],
    },
    after: {
      documents: [],
      objects: [{
        entityRef: "relay.cylinder",
        label: "relay cylinder",
        holderRef: "actor.navigator",
      }],
    },
    actorLabel: (actorRef) => actorRef === "actor.navigator" ? "the navigator" : "the captain",
    locale: "en-US",
  });
  const selected = selectProtectedTransitionSurface({
    authoredText: "Mara caught the cylinder without taking her eyes from the darkened chart.",
    compiled,
  });

  assert.equal(
    selected.text,
    "Mara caught the cylinder without taking her eyes from the darkened chart.",
  );
  assert.deepEqual(selected.sourceRefs, ["object:relay.cylinder:holder"]);
  assert.equal(selected.entityText, "the navigator took custody of relay cylinder.");
  assert.doesNotMatch(selected.text, /took custody/u);
});

test("typed transition prose remains the fallback when a world has no authored surface", () => {
  const selected = selectProtectedTransitionSurface({
    authoredText: "",
    compiled: {
      text: "The navigator took custody of the relay cylinder.",
      sourceRefs: ["object:relay.cylinder:holder"],
    },
  });
  assert.equal(selected.text, "The navigator took custody of the relay cylinder.");
});
