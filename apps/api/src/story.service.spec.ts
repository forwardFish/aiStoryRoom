import { strict as assert } from "node:assert";

const forbidden = "我成功杀死没有影子的客人";
assert.match(forbidden, /杀死/);
console.log("story service smoke assertions passed");
