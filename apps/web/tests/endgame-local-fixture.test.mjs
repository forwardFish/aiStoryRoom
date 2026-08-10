import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import test from "node:test";
import { bootGamePage } from "../public/game-bootstrap.js";

function response(payload, ok = true) { return { ok, json:async () => payload }; }
function presentation() { return { schemaVersion:"endgame_presentation_v3", resultType:"SOLO_PART_END", world:{worldId:"neutral",worldTitle:"Neutral"}, role:{roleId:"operator",roleTitle:"Operator"}, title:"Ending", axes:[], metrics:[], dynamicSubtitle:"Subtitle", style:null, narrative:"Narrative", sections:[], replayHint:"Retry", endingFingerprint:"a".repeat(64), replayActions:[{type:"BACK_TO_WORLDS",label:"Worlds",href:"/worlds",enabled:true,disabledReason:null}] }; }

test("localhost fixture renders in the real /game root without calling game API", async () => {
  const dom = new JSDOM('<main id="app"></main>', { url:"http://127.0.0.1:5177/game?endgameFixture=neutral" });
  const paths = [];
  const result = await bootGamePage({ root:dom.window.document.getElementById("app"), window:dom.window, fetchImpl:async (path) => { paths.push(path); return response({ presentation:presentation() }); } });
  assert.equal(result.fixture, true);
  assert.deepEqual(paths, ["/__local-endgame-fixtures/neutral.json"]);
  assert.match(dom.window.document.body.textContent, /Ending/);
  assert.ok(dom.window.document.querySelector('[data-testid="final-judgement"]'));
});

test("fixture mode is unavailable on non-local hosts", async () => {
  const dom = new JSDOM('<main id="app"></main>', { url:"https://example.com/game?endgameFixture=neutral" });
  let requested = "";
  await bootGamePage({ root:dom.window.document.getElementById("app"), window:dom.window, fetchImpl:async (path) => { requested=path; return response({}, false); }, loadSolo:async () => ({ createStoryApp:() => ({ boot:async () => {} }) }) });
  assert.equal(requested, "");
});
