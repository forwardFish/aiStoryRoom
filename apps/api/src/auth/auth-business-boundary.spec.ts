import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { BillingController } from "../billing/billing.controller";
import { CreditsController } from "../credits/credits.controller";
import { RoomsController } from "../rooms.controller";
import { StoryAccessController } from "../story-access/story-access.controller";
import { AuthGuard } from "./auth.guard";

test("all account, room, checkout, and unlock boundaries require verified authentication", () => {
  for (const controller of [CreditsController, BillingController, RoomsController, StoryAccessController]) {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller) || [];
    assert.ok(guards.includes(AuthGuard), `${controller.name} must be protected by AuthGuard`);
  }
});
