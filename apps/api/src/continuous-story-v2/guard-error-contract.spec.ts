import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { ApiContractExceptionFilter } from "../api-transport";

const sent: { status?: number; body?: Record<string, unknown> } = {};
const response = {
  status(value: number) {
    sent.status = value;
    return this;
  },
  json(value: Record<string, unknown>) {
    sent.body = value;
    return this;
  }
};
const host = {
  switchToHttp() {
    return {
      getResponse: () => response,
      getRequest: () => ({ method: "POST", url: "/api/v4/rooms/run/decision" })
    };
  }
};

new ApiContractExceptionFilter().catch(new BadRequestException({
  code: "GUARD_REJECTED",
  message: "这项做法使用了嘉靖时代不存在的技术或制度。",
  decision: "REJECT_OUT_OF_WORLD",
  reason: "这项做法使用了嘉靖时代不存在的技术或制度。",
  matchedRules: ["ERA_TECHNOLOGY_BOUNDARY"],
  riskFlags: [],
  suggestedRewrite: { method: "改用驿递和公文" }
}), host as never);

assert.equal(sent.status, 400);
assert.equal(sent.body?.code, "GUARD_REJECTED");
assert.equal(sent.body?.decision, "REJECT_OUT_OF_WORLD");
assert.equal(sent.body?.reason, "这项做法使用了嘉靖时代不存在的技术或制度。");
assert.deepEqual(sent.body?.matchedRules, ["ERA_TECHNOLOGY_BOUNDARY"]);
assert.deepEqual(sent.body?.riskFlags, []);
assert.deepEqual(sent.body?.suggestedRewrite, { method: "改用驿递和公文" });

console.log("continuous story v2 guard error contract: PASS");
