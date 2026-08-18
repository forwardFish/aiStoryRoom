const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const REPO = resolve(__dirname, "../../..");
const AUTHORING = resolve(REPO, "packages/templates/config/sangtian/pressure-chapter-v1/authoring");
const MARKDOWN = resolve(REPO, "docs/剧本/嘉靖财政危局/N1~N7/N1_九堰将决_三席完整剧本与JSON映射_v1.md");
const source = readFileSync(MARKDOWN, "utf8").replace(/\r\n/g, "\n");
const authoring = json(resolve(AUTHORING, "n1-multibeat-authoring-v1.json"));
const publicMainline = json(resolve(AUTHORING, "n1-authorial-public-mainline-v1.json")).publicMainline;
const seats = [
  { key: "zhejiang_governor", section: "浙江总督", prefix: "HU" },
  { key: "zhejiang_administration", section: "浙江省府", prefix: "ZHENG" },
  { key: "jiangnan_merchant", section: "江南商会", prefix: "SHEN" },
];
const seatLenses = Object.fromEntries(seats.map((seat) => [
  seat.key,
  json(resolve(AUTHORING, `n1-authorial-seat-${seat.key}-v1.json`)).seatLens,
]));
const beats = parseBeats(source);

test("approved Markdown maps losslessly to eight public and twenty-four private Beat scenes", () => {
  assert.equal(beats.length, 8);
  assert.deepEqual(Object.keys(publicMainline.beatScenes), beats.map((beat) => beat.beatKey));
  for (const seat of seats) {
    assert.deepEqual(Object.keys(seatLenses[seat.key].beatScenes), beats.map((beat) => beat.beatKey));
  }

  let privateCount = 0;
  for (const beat of beats) {
    assert.equal(publicMainline.beatScenes[beat.beatKey].text, beat.publicText, `${beat.beatId}:public`);
    for (const seat of seats) {
      privateCount += 1;
      assert.equal(
        seatLenses[seat.key].beatScenes[beat.beatKey].text,
        beat.scenes[seat.key].text,
        `${beat.beatId}:${seat.key}`,
      );
      assert.ok(seatLenses[seat.key].beatScenes[beat.beatKey].text.length >= 180);
    }
  }
  assert.equal(privateCount, 24);
  assert.equal(new Set(seats.flatMap((seat) => Object.values(seatLenses[seat.key].beatScenes).map((item) => item.text))).size, 24);
});

test("each executable Beat references only its exact three human scenes and keeps AI seat material", () => {
  for (const beat of authoring.beats) {
    const beatKey = beat.beatId.slice(-3);
    assert.ok(beat.sourceMaterialRefs.includes(`publicMainline.beatScenes.${beatKey}`));
    for (const seat of seats) {
      assert.ok(beat.sourceMaterialRefs.includes(`seatLenses.seat.${seat.key}.beatScenes.${beatKey}`));
      assert.equal(
        beat.sourceMaterialRefs.some((ref) => ref.startsWith(`seatLenses.seat.${seat.key}.`) && !ref.includes(`beatScenes.${beatKey}`) && !ref.includes(`beatNpcPressures.${beatKey}`)),
        false,
        `${beat.beatId}:${seat.key}:generic-material-leaked`,
      );
    }
    for (const aiSeat of ["qingliu_law", "sili_weaving", "cabinet_finance"]) {
      assert.ok(beat.sourceMaterialRefs.some((ref) => ref.startsWith(`seatLenses.seat.${aiSeat}.`)), `${beat.beatId}:${aiSeat}`);
    }
  }
});

test("B07 and B08 carry independent per-seat NPC pressure without shifting Settlement reaction indices", () => {
  for (const beatKey of ["B07", "B08"]) {
    const beat = authoring.beats.find((candidate) => candidate.beatId === `N1.${beatKey}`);
    for (const seat of seats) {
      const expectedRef = `seatLenses.seat.${seat.key}.beatNpcPressures.${beatKey}`;
      assert.ok(beat.sourceMaterialRefs.includes(expectedRef));
      assert.equal(seatLenses[seat.key].beatNpcPressures[beatKey].text, beats.find((item) => item.beatKey === beatKey).scenes[seat.key].npcText);
    }
  }
  const npcFiles = ["n1-authorial-npc-after-prepare-v1.json", "n1-authorial-npc-before-commit-v1.json", "n1-authorial-npc-settlement-v1.json"];
  assert.deepEqual(npcFiles.map((file) => json(resolve(AUTHORING, file)).npcReactions.length), [12, 6, 6]);
});

function parseBeats(markdown) {
  const matches = [...markdown.matchAll(/^# Beat (\d+)｜`(N1\.B\d{2})` ([^\n]+)$/gmu)];
  return matches.map((match, index) => {
    const block = markdown.slice(match.index, matches[index + 1]?.index ?? markdown.indexOf("# 三、N1 章末"));
    const beatKey = `B${String(Number(match[1])).padStart(2, "0")}`;
    const publicBlock = section(block, "## 2. 公共事件", "---");
    const publicNarrative = publicBlock.split(/\n\s*\n/u).map((part) => part.trim()).filter((part) => part && !part.startsWith("**")).join("\n\n");
    const publicText = publicNarrative || publicBlock.replace(/\*\*/gu, "").replace(/  $/gmu, "").trim();
    const scenes = Object.fromEntries(seats.map((seat) => {
      const start = block.search(new RegExp(`^## \\d+\\. ${seat.section}[^\\n]*$`, "mu"));
      assert.notEqual(start, -1, `${beatKey}:${seat.key}:section`);
      const next = block.slice(start + 1).search(/^## \d+\.|^## 6\./mu);
      const seatBlock = block.slice(start, next < 0 ? undefined : start + 1 + next);
      return [seat.key, {
        text: section(seatBlock, `#### 私人现场（SCENE-${seat.prefix}-${beatKey}）`, "#### 此刻知道／不知道").trim(),
        npcText: section(seatBlock, "#### NPC 与施压", "#### 独有决策问题").trim(),
      }];
    }));
    return { beatId: match[2], beatKey, publicText, scenes };
  });
}

function section(input, startHeading, endHeading) {
  const start = input.indexOf(startHeading);
  assert.notEqual(start, -1, startHeading);
  const from = start + startHeading.length;
  const end = input.indexOf(endHeading, from);
  return input.slice(from, end < 0 ? undefined : end).replace(/^\s+|\s+$/gu, "");
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
