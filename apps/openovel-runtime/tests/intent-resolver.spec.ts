import assert from "node:assert/strict";
import test from "node:test";
import {
  DeterministicAffordanceIntentResolver,
  INTENT_RESOLUTION_SCHEMA,
} from "../src/intent-resolver.js";
import type { OpenNovelOption } from "../src/types.js";

const resolver = new DeterministicAffordanceIntentResolver();

test("semantic-equivalent Sangtian free text binds the published opening affordance", () => {
  const options: OpenNovelOption[] = [
    {
      id: "opening_d1",
      label: "暂不签发放行文书，留下巡抚书吏，同时核对密信中指出的县册疑点。",
      effect: {
        intent: "把催办公文暂压在案上，先让送文双方说明各自已经知道的事实。",
      },
    },
    {
      id: "opening_d2",
      label: "动用封缄令牌，先保住档房现场，再给出暂缓签发的答复。",
      effect: {
        intent: "公开封存档房并限期复核。",
      },
    },
  ];

  const result = resolver.resolve({
    action: "暂不签发，先让两边把各自知道的事说清。",
    affordances: options,
  });

  assert.equal(result.schemaVersion, INTENT_RESOLUTION_SCHEMA);
  assert.equal(result.status, "BOUND_AFFORDANCE");
  assert.equal(result.intentType, "AFFORDANCE_EQUIVALENT");
  assert.equal(result.matchedAffordanceId, "opening_d1");
  assert.equal(result.canonicalAction, options[0]!.label);
  assert.ok(result.confidence >= 0.75);
});

test("the same resolver binds a neutral second-world fixture without story vocabulary", () => {
  const options: OpenNovelOption[] = [
    {
      id: "council.delay",
      label: "Delay the launch and question both envoys before release.",
      effect: {
        decisionPointId: "council.release-window",
        intent: "Hold the release while both delegates state what they know.",
      },
    },
    {
      id: "council.release",
      label: "Authorize immediate release and seal the cargo manifest.",
      effect: {
        decisionPointId: "council.release-window",
        intent: "Release immediately under a recorded manifest.",
      },
    },
  ];

  const result = resolver.resolve({
    action: "Delay the launch until both envoys explain what they know.",
    affordances: options,
  });

  assert.equal(result.status, "BOUND_AFFORDANCE");
  assert.equal(result.matchedAffordanceId, "council.delay");
  assert.equal(result.capabilityRef, "decision-point:council.release-window");
  assert.deepEqual(result.targetRefs, ["council.release-window"]);
});

test("ambiguous language requests clarification instead of guessing a Kernel", () => {
  const options: OpenNovelOption[] = [
    { id: "ask.first", label: "Ask the first envoy for the records." },
    { id: "ask.second", label: "Ask the second envoy for the records." },
  ];

  const result = resolver.resolve({
    action: "Ask the envoy for the records.",
    affordances: options,
  });

  assert.equal(result.status, "CLARIFICATION_REQUIRED");
  assert.equal(result.matchedAffordanceId, null);
  assert.equal(result.canonicalAction, null);
  assert.equal(result.alternatives.length, 2);
});

test("unrelated language is rejected without inventing a capability", () => {
  const result = resolver.resolve({
    action: "Rotate the observatory mirror toward the comet.",
    affordances: [
      { id: "ledger.read", label: "Read the sealed ledger in the archive." },
      { id: "ledger.leave", label: "Leave the sealed ledger untouched." },
    ],
  });

  assert.equal(result.status, "OUT_OF_SCOPE");
  assert.equal(result.capabilityRef, null);
  assert.equal(result.matchedAffordanceId, null);
});

test("punctuation and Unicode width do not change exact binding", () => {
  const option: OpenNovelOption = {
    id: "neutral.confirm",
    label: "Confirm the boundary before proceeding",
  };
  const result = resolver.resolve({
    action: "Ｃｏｎｆｉｒｍ　ｔｈｅ　ｂｏｕｎｄａｒｙ，ｂｅｆｏｒｅ　ｐｒｏｃｅｅｄｉｎｇ！",
    affordances: [option],
  });
  assert.equal(result.status, "BOUND_AFFORDANCE");
  assert.equal(result.confidence, 1);
});
