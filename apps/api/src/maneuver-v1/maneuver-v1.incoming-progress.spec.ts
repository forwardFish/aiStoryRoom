import assert from "node:assert/strict";
import test from "node:test";
import { projectIncomingContactProgressV1 } from "./maneuver-v1.prisma-read";

test("targeted conversations become player-safe incoming progress rows", () => {
  const projected = projectIncomingContactProgressV1([{
    id: "action.contact.1",
    status: "PENDING",
    freeText: "Bring the signed copy before the meeting.",
    intent: "internal fallback",
    visibility: "TARGETED",
    role: { roleName: "Records Officer", hiddenSecret: "must-not-project" },
    normalizedJson: { compiled: { primaryEffect: "must-not-project" } },
  }]);
  assert.deepEqual(projected, [{
    actionId: "action.contact.1",
    label: "Records Officer: Bring the signed copy before the meeting.",
    status: "PENDING",
  }]);
  assert.equal(JSON.stringify(projected).includes("must-not-project"), false);
});

test("private, malformed, and unlabeled rows are not projected", () => {
  assert.deepEqual(projectIncomingContactProgressV1([{
    id: "action.private", status: "PENDING", freeText: "Hidden", visibility: "PRIVATE", role: { roleName: "Hidden" },
  }, {
    id: "action.no-role", status: "PENDING", freeText: "No source", visibility: "TARGETED", role: null,
  }, {
    id: "action.no-message", status: "PENDING", freeText: "", intent: "", visibility: "PUBLIC", role: { roleName: "Coordinator" },
  }]), []);
});

test("intent is used only when a committed direct message has no freeText", () => {
  assert.deepEqual(projectIncomingContactProgressV1([{
    id: "action.contact.2",
    status: "RESOLVED",
    freeText: null,
    intent: "Request a bounded response.",
    visibility: "PUBLIC",
    role: { roleName: "Coordinator" },
  }]), [{
    actionId: "action.contact.2",
    label: "Coordinator: Request a bounded response.",
    status: "RESOLVED",
  }]);
});
