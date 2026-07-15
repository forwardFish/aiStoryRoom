import assert from "node:assert/strict";
import { safeAuthReturnTo } from "./auth-return-to";

assert.equal(safeAuthReturnTo("/join?room=ROOM1&ref=REF1&channel=LINK"), "/join?room=ROOM1&ref=REF1&channel=LINK");
assert.equal(safeAuthReturnTo("/rooms/room_1?from=invite"), "/rooms/room_1?from=invite");
assert.equal(safeAuthReturnTo("/worlds/caesar"), "/worlds/caesar");
assert.equal(safeAuthReturnTo("https://evil.example/rooms"), "/");
assert.equal(safeAuthReturnTo("//evil.example/rooms"), "/");
assert.equal(safeAuthReturnTo("/api/v4/auth/google"), "/");
assert.equal(safeAuthReturnTo("/rooms/../../api"), "/");
console.log("auth return-to allowlist assertions passed");
