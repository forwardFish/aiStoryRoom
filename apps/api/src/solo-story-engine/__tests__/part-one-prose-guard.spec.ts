import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizedPartOneProceduralDerivations,
  authorizedPartOneProceduralGuidance,
  containsUnauthorizedPartOneDiscovery
} from "../part-one-prose-guard";

test("keeps established in-room props available through actor continuity", () => {
  const authorized = authorizedPartOneProceduralDerivations(
    "巡抚书吏当场回禀；清流县令亲随仍在内厅。"
  ).join("\n");

  assert.equal(
    containsUnauthorizedPartOneDiscovery("巡抚书吏仍捧着回文匣。", authorized),
    false
  );
  assert.equal(
    containsUnauthorizedPartOneDiscovery("清流县令亲随仍举着原来的封套。", authorized),
    false
  );
});

test("rejects a second sheet when the settled action uses the same reply document", () => {
  const eventText = "在现有公文上批明暂准放行，并在同一份回文中逐项写明督抚分歧。";
  const authorized = [
    eventText,
    ...authorizedPartOneProceduralDerivations(eventText)
  ].join("\n");

  assert.equal(
    containsUnauthorizedPartOneDiscovery("总督又取一纸另书，作为附页压在公文下面。", authorized),
    true
  );
  assert.match(
    authorizedPartOneProceduralGuidance(eventText).join("\n"),
    /不得另取纸张/
  );
});

test("allows a figurative comparison to testimony but still rejects a real new confession", () => {
  assert.equal(
    containsUnauthorizedPartOneDiscovery(
      "两封文书各自摊着，像两道不肯相合的口供。",
      ""
    ),
    false
  );
  assert.equal(
    containsUnauthorizedPartOneDiscovery(
      "改桑书吏已经留下口供，承认亲手改过县册。",
      ""
    ),
    true
  );
});

test("allows visual contrast between known documents but rejects ink as a new forgery clue", () => {
  assert.equal(
    containsUnauthorizedPartOneDiscovery(
      "两纸墨色一浓一淡，像两截没对上的账。",
      ""
    ),
    false
  );
  assert.equal(
    containsUnauthorizedPartOneDiscovery(
      "县册上的墨色一浓一淡，显然是后来补写。",
      ""
    ),
    true
  );
});

test("allows neutral handwriting texture on the known county letter but rejects handwriting evidence", () => {
  const authorized = "总督已经读过清流县令密信，密信只报疑，不能定罪。";
  assert.equal(
    containsUnauthorizedPartOneDiscovery(
      "密信压着清流县令只敢报疑不敢告罪的笔迹。",
      authorized
    ),
    false
  );
  assert.equal(
    containsUnauthorizedPartOneDiscovery(
      "密信上的笔迹不像清流县令，显然是后来补写。",
      authorized
    ),
    true
  );
});

test("allows prepared speech texture but still rejects a prepared document", () => {
  assert.equal(
    containsUnauthorizedPartOneDiscovery(
      "他像是把一句早已备好的话原样转述出来。",
      ""
    ),
    false
  );
  assert.equal(
    containsUnauthorizedPartOneDiscovery(
      "他从袖中取出早已备好的催问条陈。",
      ""
    ),
    true
  );
});

test("allows drying ink only when the current action has just written the document", () => {
  const eventText = "把不得趁急难压价买田写入放行文书。";
  const authorized = [
    eventText,
    ...authorizedPartOneProceduralDerivations(eventText)
  ].join("\n");
  assert.equal(
    containsUnauthorizedPartOneDiscovery("案上回文压着，墨色渐干。", authorized),
    false
  );
  assert.equal(
    containsUnauthorizedPartOneDiscovery("旧县册上的墨色渐干。", ""),
    true
  );
});

test("rejects an uncommitted NPC threat to send another emissary", () => {
  assert.equal(
    containsUnauthorizedPartOneDiscovery(
      "卑职今日若空匣回去，中丞必再遣人。",
      ""
    ),
    true
  );
  assert.equal(
    containsUnauthorizedPartOneDiscovery(
      "中丞已经明令再遣人来取回文。",
      "中丞已经明令再遣人来取回文。"
    ),
    false
  );
});
