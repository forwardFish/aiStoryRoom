import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORDER = ["hook", "challenge", "rewind", "role", "conflict", "choice", "selection", "consequences", "product", "logo"];
const LABELS = {
  hook: "命运终点", challenge: "观众挑战", rewind: "时间倒带", role: "角色代入", conflict: "剧情冲突",
  choice: "观众选择", selection: "选择确认", consequences: "连锁后果", product: "产品机制", logo: "Logo 与 CTA"
};
const TRANSITIONS = {
  hook: "black flash + impact", challenge: "freeze + blur", rewind: "reverse cuts + motion blur", role: "soft push-in",
  conflict: "portrait split", choice: "UI cards stagger in", selection: "selected card highlight",
  consequences: "three rapid result cards", product: "role network reveal", logo: "existing logo hard cut"
};
const AUDIO = {
  hook: "low impact", challenge: "brief silence / heartbeat", rewind: "rewind sweep", role: "music re-enters",
  conflict: "low pulse builds", choice: "UI open + one-second pause", selection: "click + short hit",
  consequences: "three consequence hits", product: "music lift", logo: "existing logo sonic mark"
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const round = (value) => Number(value.toFixed(3));

export function tc(seconds, separator = ",") {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${separator}${String(ms).padStart(3, "0")}`;
}

function get(target, dotPath) {
  return dotPath.split(".").reduce((value, key) => value == null ? undefined : value[key], target);
}

function text(spec, dotPath, errors, max = 120) {
  const value = get(spec, dotPath);
  if (typeof value !== "string" || value.trim() === "") errors.push(`${dotPath} must be a non-empty string.`);
  else if (value.length > max) errors.push(`${dotPath} must not exceed ${max} characters.`);
}

function number(spec, dotPath, errors, min, max) {
  const value = get(spec, dotPath);
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${dotPath} must be a finite number.`);
  else if (value < min || value > max) errors.push(`${dotPath} must be between ${min} and ${max}.`);
}

export function sceneDraft(spec) {
  const selected = spec.choices.find((item) => item.id === spec.selectedChoiceId);
  const content = {
    hook: { copy: [spec.hook.endpoint], visual: spec.hook.visualCue, asset: spec.assets.hookImage },
    challenge: { copy: [spec.hook.question], visual: "Freeze the fate endpoint and make the challenge dominant.", asset: spec.assets.hookImage },
    rewind: { copy: spec.rewind.label ? [spec.rewind.label] : [], visual: spec.rewind.frames.join(" → "), asset: spec.assets.rewindImages.join(" | ") },
    role: { copy: [spec.player.roleLine, spec.player.relationshipLine], visual: spec.player.visualCue, asset: spec.assets.playerPortrait },
    conflict: { copy: [...spec.conflict.lines, ...spec.conflict.dilemmaLines], visual: spec.conflict.visualCue, asset: spec.assets.conflictPortraits.join(" | ") },
    choice: { copy: ["WHAT WOULD YOU DO?", ...spec.choices.map((item) => item.label)], visual: "Show real or faithful choice UI and pause before revealing the answer.", asset: spec.assets.gameUiImage },
    selection: { copy: ["YOU CHOOSE:", selected?.label ?? ""], visual: "Highlight the selected option and fade the others.", asset: spec.assets.gameUiImage },
    consequences: { copy: [...spec.consequences.flatMap((item) => [item.character, item.effect]), spec.worldResult], visual: spec.consequences.map((item) => `${item.character}: ${item.visualCue}`).join(" | "), asset: spec.assets.consequencePortraits.join(" | ") },
    product: { copy: spec.productMessage, visual: "Connect multiple role cards inside one shared world and briefly show real UI.", asset: `${spec.assets.worldImage} | ${spec.assets.gameUiImage}` },
    logo: { copy: [spec.brand.productName, spec.brand.tagline, spec.brand.cta], visual: "Insert the existing logo video and preserve one CTA.", asset: spec.assets.logoVideo }
  };
  let cursor = 0;
  return ORDER.map((id, index) => {
    const duration = spec.timing[id];
    const start = cursor;
    cursor += duration;
    return { index: index + 1, id, label: LABELS[id], start: round(start), end: round(cursor), duration, transition: TRANSITIONS[id], audio: AUDIO[id], ...content[id] };
  });
}

export function validateSpec(spec, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(spec)) return { errors: [`${options.source ?? "video spec"} must contain a JSON object.`], warnings };

  text(spec, "schemaVersion", errors, 10);
  if (spec.schemaVersion !== "1.0") errors.push('schemaVersion must equal "1.0".');
  text(spec, "videoId", errors, 80);
  if (typeof spec.videoId === "string" && !/^[a-z0-9][a-z0-9-]{2,79}$/.test(spec.videoId)) errors.push("videoId must be kebab-case and 3-80 characters long.");
  text(spec, "series", errors, 80);
  number(spec, "format.width", errors, 1080, 1080);
  number(spec, "format.height", errors, 1920, 1920);
  number(spec, "format.fps", errors, 24, 30);
  number(spec, "format.durationSeconds", errors, 20, 32);
  for (const side of ["top", "right", "bottom", "left"]) number(spec, `format.safeMargins.${side}`, errors, 50, 450);

  for (const key of ["productName", "tagline", "cta"]) text(spec, `brand.${key}`, errors, key === "tagline" ? 110 : 40);
  for (const key of ["ink", "paper", "accent", "accentSoft", "danger"]) {
    text(spec, `brand.palette.${key}`, errors, 7);
    const value = get(spec, `brand.palette.${key}`);
    if (typeof value === "string" && !/^#[0-9a-f]{6}$/i.test(value)) errors.push(`brand.palette.${key} must be a six-digit hex color.`);
  }
  for (const key of ["name", "time", "fateTarget", "location"]) text(spec, `world.${key}`, errors, 60);
  for (const key of ["type", "endpoint", "question", "visualCue"]) text(spec, `hook.${key}`, errors, key === "visualCue" ? 260 : 60);
  if (!new Set(["fate-endpoint", "countdown", "relationship-betrayal", "counterfactual", "unexpected-ending"]).has(spec.hook?.type)) errors.push("hook.type is not supported.");

  if (!Array.isArray(spec.rewind?.frames) || spec.rewind.frames.length < 3 || spec.rewind.frames.length > 4) errors.push("rewind.frames must contain 3 or 4 visual beats.");
  for (const key of ["role", "roleLine", "relationshipLine", "visualCue"]) text(spec, `player.${key}`, errors, key === "visualCue" ? 260 : 64);
  if (!Array.isArray(spec.conflict?.lines) || spec.conflict.lines.length < 2 || spec.conflict.lines.length > 3) errors.push("conflict.lines must contain 2 or 3 lines.");
  if (!Array.isArray(spec.conflict?.dilemmaLines) || spec.conflict.dilemmaLines.length < 1 || spec.conflict.dilemmaLines.length > 2) errors.push("conflict.dilemmaLines must contain 1 or 2 lines.");
  text(spec, "conflict.visualCue", errors, 260);

  if (!Array.isArray(spec.choices) || spec.choices.length !== 3) errors.push("choices must contain exactly 3 strategy options.");
  else {
    const ids = new Set();
    spec.choices.forEach((item, index) => {
      if (!isObject(item)) return errors.push(`choices[${index}] must be an object.`);
      for (const key of ["id", "label", "strategy"]) if (typeof item[key] !== "string" || !item[key].trim()) errors.push(`choices[${index}].${key} must be a non-empty string.`);
      if (ids.has(item.id)) errors.push(`choices[${index}].id duplicates ${item.id}.`);
      ids.add(item.id);
      if (item.label?.length > 26) errors.push(`choices[${index}].label exceeds 26 characters.`);
    });
    if (!ids.has(spec.selectedChoiceId)) errors.push("selectedChoiceId must match one of the three choice IDs.");
  }

  if (!Array.isArray(spec.consequences) || spec.consequences.length !== 3) errors.push("consequences must contain exactly 3 visible cross-character effects.");
  else spec.consequences.forEach((item, index) => {
    for (const key of ["character", "effect", "visualCue"]) if (typeof item?.[key] !== "string" || !item[key].trim()) errors.push(`consequences[${index}].${key} must be a non-empty string.`);
  });
  text(spec, "worldResult", errors, 52);
  if (!Array.isArray(spec.productMessage) || spec.productMessage.length < 2 || spec.productMessage.length > 3) errors.push("productMessage must contain 2 or 3 short lines.");

  if (!isObject(spec.timing)) errors.push("timing must define all ten scene durations.");
  else {
    ORDER.forEach((id) => number(spec, `timing.${id}`, errors, 0.1, 8));
    const durations = ORDER.map((id) => spec.timing[id]);
    if (durations.every(Number.isFinite) && Math.abs(sum(durations) - spec.format.durationSeconds) > 0.02) errors.push(`Scene durations total ${round(sum(durations))}s but format.durationSeconds is ${spec.format.durationSeconds}s.`);
  }

  const arrays = [["rewindImages", 3, 4], ["conflictPortraits", 2, 3], ["consequencePortraits", 3, 3]];
  for (const [key, min, max] of arrays) if (!Array.isArray(spec.assets?.[key]) || spec.assets[key].length < min || spec.assets[key].length > max) errors.push(`assets.${key} must contain ${min === max ? min : `${min}-${max}`} paths.`);
  for (const key of ["hookImage", "playerPortrait", "worldImage", "gameUiImage", "logoVideo"]) text(spec, `assets.${key}`, errors, 240);
  text(spec, "publish.landingPath", errors, 240);
  if (!Array.isArray(spec.publish?.captionVariants) || spec.publish.captionVariants.length < 2) errors.push("publish.captionVariants must contain at least 2 captions.");
  if (!Array.isArray(spec.publish?.hashtags) || spec.publish.hashtags.length < 2) errors.push("publish.hashtags must contain at least 2 hashtags.");

  const visualText = [spec.hook?.visualCue, spec.player?.visualCue, spec.conflict?.visualCue, ...(spec.consequences ?? []).map((item) => item?.visualCue)].filter(Boolean).join(" ");
  if (/\b(gore|gory|dismember|open wound|blood spray|severed)\b/i.test(visualText)) errors.push("Visual cues must remain non-graphic and platform-safe.");
  if (errors.length === 0) {
    for (const scene of sceneDraft(spec)) {
      const load = scene.copy.join(" ").length / scene.duration;
      if (load > 24) warnings.push(`${scene.id} carries ${load.toFixed(1)} characters/second; shorten copy or extend the scene.`);
    }
  }
  if (options.strictAssets) {
    const base = options.assetBaseDir ?? ROOT;
    const assets = [spec.assets.hookImage, ...spec.assets.rewindImages, spec.assets.playerPortrait, ...spec.assets.conflictPortraits, ...spec.assets.consequencePortraits, spec.assets.worldImage, spec.assets.gameUiImage, spec.assets.logoVideo];
    for (const item of assets) if (!existsSync(path.resolve(base, item))) errors.push(`Missing asset: ${item}`);
  }
  return { errors, warnings };
}

export function buildScenes(spec) {
  const result = validateSpec(spec);
  if (result.errors.length) throw new Error(`Invalid video spec:\n- ${result.errors.join("\n- ")}`);
  return sceneDraft(spec);
}

