import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildScenes, generateVideoKit, validateSpec } from "../scripts/video-kit.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(TEST_DIR, "..");

async function readExample(name = "caesar-brutus-fate.json") {
  return JSON.parse(await readFile(path.join(KIT_ROOT, "examples", name), "utf8"));
}

test("all committed example specs validate", async () => {
  const files = (await readdir(path.join(KIT_ROOT, "examples"))).filter((name) => name.endsWith(".json"));
  assert.ok(files.length >= 3);

  for (const file of files) {
    const spec = await readExample(file);
    const result = validateSpec(spec, { source: file });
    assert.deepEqual(result.errors, [], `${file}: ${result.errors.join("; ")}`);
  }
});

test("fixed scene template resolves to ten ordered scenes and exact duration", async () => {
  const spec = await readExample();
  const scenes = buildScenes(spec);

  assert.equal(scenes.length, 10);
  assert.deepEqual(scenes.map((scene) => scene.id), [
    "hook",
    "challenge",
    "rewind",
    "role",
    "conflict",
    "choice",
    "selection",
    "consequences",
    "product",
    "logo"
  ]);
  assert.equal(scenes[0].start, 0);
  assert.equal(scenes.at(-1).end, 27);
  assert.equal(scenes.find((scene) => scene.id === "selection").copy.at(-1), "DECEIVE THEM BOTH");
});

test("generator creates editor-ready and visual storyboard outputs", async () => {
  const spec = await readExample();
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "omw-video-kit-"));

  try {
    const result = await generateVideoKit(spec, outputDir);
    assert.equal(result.scenes.length, 10);

    const required = [
      "manifest.json",
      "contact-sheet.svg",
      "storyboard.md",
      "subtitles.srt",
      "edit-decision-list.csv",
      "asset-checklist.md",
      "frames/01-hook.svg",
      "frames/10-logo.svg"
    ];

    for (const relativePath of required) {
      const content = await readFile(path.join(outputDir, relativePath), "utf8");
      assert.ok(content.length > 50, `${relativePath} should not be empty`);
    }

    const manifest = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    assert.equal(manifest.videoId, "caesar-brutus-fate");
    assert.equal(manifest.sceneCount, 10);
    assert.ok(manifest.files.some((file) => file.path === "contact-sheet.svg"));

    const srt = await readFile(path.join(outputDir, "subtitles.srt"), "utf8");
    assert.match(srt, /00:00:00,000 --> 00:00:01,800/);
    assert.match(srt, /CAN YOU CHANGE HIS FATE\?/);
    assert.match(srt, /EVERY CHOICE CHANGES THE SAME WORLD\./);

    const svg = await readFile(path.join(outputDir, "frames/06-choice.svg"), "utf8");
    assert.match(svg, /WHAT WOULD YOU DO\?/);
    assert.match(svg, /WARN CAESAR/);
    assert.match(svg, /DECEIVE THEM BOTH/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("validator fails closed on malformed choice and timing contracts", async () => {
  const spec = await readExample();
  spec.choices = spec.choices.slice(0, 2);
  spec.selectedChoiceId = "missing-choice";
  spec.timing.logo = 3;

  const result = validateSpec(spec);
  assert.ok(result.errors.some((error) => error.includes("exactly 3")));
  assert.ok(result.errors.some((error) => error.includes("Scene durations total")));
});

test("visual directions reject explicitly graphic production cues", async () => {
  const spec = await readExample();
  spec.hook.visualCue = "A gory close-up with an open wound.";

  const result = validateSpec(spec);
  assert.ok(result.errors.some((error) => error.includes("non-graphic")));
});

test("manifest hashes change when source copy changes", async () => {
  const spec = await readExample();
  const outputA = await mkdtemp(path.join(os.tmpdir(), "omw-video-a-"));
  const outputB = await mkdtemp(path.join(os.tmpdir(), "omw-video-b-"));

  try {
    await generateVideoKit(spec, outputA);
    const manifestA = JSON.parse(await readFile(path.join(outputA, "manifest.json"), "utf8"));

    const changed = structuredClone(spec);
    changed.publish.captionVariants[0] = "A different caption for a controlled creative test.";
    await generateVideoKit(changed, outputB);
    const manifestB = JSON.parse(await readFile(path.join(outputB, "manifest.json"), "utf8"));

    assert.notEqual(manifestA.sourceSpecSha256, manifestB.sourceSpecSha256);
  } finally {
    await rm(outputA, { recursive: true, force: true });
    await rm(outputB, { recursive: true, force: true });
  }
});
