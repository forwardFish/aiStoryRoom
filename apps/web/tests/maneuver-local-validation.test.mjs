import assert from "node:assert/strict";
import test from "node:test";
import {
  renderLeverageHand,
  validateManeuverCommand,
} from "../public/maneuver-four-ui.js";

function panel() {
  return {
    enabled: true,
    disabledReason: null,
    contact: { enabled: true, disabledReason: null, options: [] },
    investigate: { enabled: true, disabledReason: null, options: [] },
    leverage: { enabled: true, disabledReason: null, options: [] },
    custom: { enabled: true, disabledReason: null, maxLength: 200 },
  };
}

test("contact and custom drafts enforce the documented 200 character limit before requesting the API", () => {
  const view = { maneuverPanel: panel() };
  const contact = validateManeuverCommand({
    maneuverType: "contact",
    targetRoleKey: "actor",
    messageText: "问".repeat(201),
  }, view);
  const custom = validateManeuverCommand({
    maneuverType: "custom",
    customText: "谋".repeat(201),
  }, view);

  assert.match(contact.reason, /最多 200 字/);
  assert.match(custom.reason, /最多 200 字/);
  assert.equal(validateManeuverCommand({
    maneuverType: "contact",
    targetRoleKey: "actor",
    messageText: "问".repeat(200),
  }, view), null);
  assert.equal(validateManeuverCommand({
    maneuverType: "custom",
    customText: "谋".repeat(200),
  }, view), null);
});

test("missing leverage projection is not misreported as an exhausted hand", () => {
  const missing = renderLeverageHand({});
  const exhausted = renderLeverageHand({ leverageHand: { availableCount: 0, items: [] } });

  assert.match(missing, /筹码信息暂不可用/);
  assert.doesNotMatch(missing, /已经全部使用/);
  assert.match(exhausted, /已经全部使用/);
});
