import assert from "node:assert/strict";
import { extractStoryPreview } from "../streamed-story-preview";

void (() => {
  assert.deepEqual(extractStoryPreview("亲随已经出发"), {
    title: "",
    text: "亲随已经出发"
  });
  assert.deepEqual(extractStoryPreview("亲随说：“遵命。”\n\n府门外传来马蹄"), {
    title: "",
    text: "亲随说：“遵命。”\n\n府门外传来马蹄"
  });
  assert.equal(extractStoryPreview('{"story":{"resultNarrative":"内部旧协议"}}'), null);
  assert.equal(extractStoryPreview(""), null);
  console.log("solo plain-prose stream preview: PASS");
})();
