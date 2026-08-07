import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { sceneDraft, tc, validateSpec } from "./spec.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const xml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const csv = (value) => /[",\n]/.test(String(value ?? "")) ? `"${String(value ?? "").replaceAll('"', '""')}"` : String(value ?? "");

function wrap(value, limit = 25) {
  const words = String(value).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > limit) { lines.push(current); current = word; } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

function svgText(lines, y, size, fill, limit = 25) {
  const expanded = lines.flatMap((line) => wrap(line, limit));
  const lineHeight = Math.round(size * 1.22);
  const start = y - ((expanded.length - 1) * lineHeight) / 2;
  return expanded.map((line, index) => `<text x="540" y="${start + index * lineHeight}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${size}" font-weight="850" fill="${fill}">${xml(line)}</text>`).join("\n");
}

function art(spec, scene) {
  const p = spec.brand.palette;
  if (scene.id === "choice" || scene.id === "selection") return spec.choices.map((item, index) => {
    const y = 560 + index * 220;
    const selected = scene.id === "selection" && item.id === spec.selectedChoiceId;
    return `<rect x="125" y="${y}" width="830" height="165" rx="38" fill="${selected ? p.accent : p.paper}" opacity=".94"/><text x="540" y="${y + 102}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="46" font-weight="850" fill="${selected ? p.paper : p.ink}">${xml(item.label)}</text>`;
  }).join("\n");
  if (scene.id === "consequences") return spec.consequences.map((item, index) => {
    const y = 390 + index * 315;
    return `<rect x="100" y="${y}" width="880" height="250" rx="42" fill="${p.paper}" opacity=".94"/><circle cx="235" cy="${y + 125}" r="72" fill="${index === 0 ? p.accent : index === 1 ? p.danger : p.ink}"/><text x="355" y="${y + 105}" font-family="Inter,Arial,sans-serif" font-size="40" font-weight="900" fill="${p.ink}">${xml(item.character)}</text><text x="355" y="${y + 165}" font-family="Inter,Arial,sans-serif" font-size="31" font-weight="650" fill="${p.ink}">${xml(item.effect)}</text>`;
  }).join("\n");
  if (scene.id === "product") return `<path d="M540 580 L280 850 M540 580 L800 850 M540 580 L390 1130 M540 580 L690 1130" stroke="${p.accentSoft}" stroke-width="12"/><circle cx="540" cy="580" r="120" fill="${p.accent}"/>${[[280,850],[800,850],[390,1130],[690,1130]].map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="88" fill="${p.paper}"/><text x="${x}" y="${y+10}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="850" fill="${p.ink}">ROLE ${i+1}</text>`).join("")}`;
  if (scene.id === "rewind") return `<path d="M820 550 C950 650 950 900 820 1000" fill="none" stroke="${p.accentSoft}" stroke-width="24"/><path d="M820 1000 L850 930 L900 995" fill="${p.accentSoft}"/>${[0,1,2].map((i)=>`<rect x="${105+i*300}" y="555" width="250" height="500" rx="35" fill="${p.paper}" opacity="${.23+i*.08}"/><circle cx="${230+i*300}" cy="745" r="82" fill="${i===2?p.accent:p.ink}"/>`).join("")}`;
  if (scene.id === "conflict") return `<rect x="90" y="430" width="410" height="690" rx="48" fill="${p.paper}" opacity=".16"/><rect x="580" y="430" width="410" height="690" rx="48" fill="${p.paper}" opacity=".16"/><circle cx="295" cy="710" r="125" fill="${p.ink}"/><circle cx="785" cy="710" r="125" fill="${p.danger}"/><path d="M540 440 V1120" stroke="${p.accentSoft}" stroke-width="8" stroke-dasharray="18 20"/>`;
  return `<circle cx="540" cy="730" r="260" fill="${p.paper}" opacity=".15"/><circle cx="540" cy="675" r="135" fill="${p.ink}" opacity=".82"/><path d="M300 1050 C330 835 430 795 540 795 C650 795 750 835 780 1050 Z" fill="${p.ink}" opacity=".8"/>`;
}

export function renderFrameSvg(spec, scene) {
  const p = spec.brand.palette;
  const primary = scene.id === "choice" ? ["WHAT WOULD YOU DO?"] : scene.id === "selection" ? ["YOU CHOOSE:", spec.choices.find((item) => item.id === spec.selectedChoiceId)?.label ?? ""] : scene.id === "consequences" ? [spec.worldResult] : scene.id === "logo" ? [spec.brand.productName, spec.brand.cta] : scene.copy;
  const y = ["choice", "selection"].includes(scene.id) ? 315 : scene.id === "consequences" ? 1475 : 1335;
  const size = scene.id === "challenge" ? 72 : scene.id === "conflict" ? 48 : 58;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${p.ink}"/><stop offset=".62" stop-color="${p.accent}" stop-opacity=".76"/><stop offset="1" stop-color="${p.danger}" stop-opacity=".72"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#bg)"/><rect x="100" y="150" width="880" height="1470" rx="28" fill="none" stroke="${p.accentSoft}" stroke-width="3" stroke-dasharray="16 14" opacity=".46"/><text x="100" y="105" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="800" fill="${p.accentSoft}">${xml(spec.series)}</text><text x="980" y="105" text-anchor="end" font-family="Inter,Arial,sans-serif" font-size="26" font-weight="700" fill="${p.accentSoft}">${xml(spec.world.name)} · ${xml(spec.world.time)}</text>${art(spec, scene)}${svgText(primary, y, size, p.paper, scene.id === "conflict" ? 31 : 25)}<text x="100" y="1730" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="800" fill="${p.accentSoft}">${String(scene.index).padStart(2,"0")} · ${xml(scene.label)}</text><text x="980" y="1730" text-anchor="end" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="750" fill="${p.accentSoft}">${tc(scene.start,":").slice(3,8)}–${tc(scene.end,":").slice(3,8)}</text><text x="100" y="1810" font-family="Inter,Arial,sans-serif" font-size="23" font-weight="600" fill="${p.paper}" opacity=".65">STORYBOARD PLACEHOLDER · REPLACE WITH FINAL IMAGE / UI</text></svg>`;
}

function storyboard(spec, scenes, validation) {
  const rows = scenes.map((scene) => `| ${scene.index} | ${tc(scene.start,":").slice(3,8)}–${tc(scene.end,":").slice(3,8)} | ${scene.label} | ${scene.copy.join("<br>")} | ${scene.visual.replaceAll("|","\\|")} | ${scene.transition} | ${scene.audio} |`).join("\n");
  return `# ${spec.videoId} 分镜与剪辑单\n\n> 自动生成。正式成片需使用最终人物图、真实游戏 UI 和现有 Logo 视频替换 SVG 示意图。\n\n## 规格\n\n- 系列：${spec.series}\n- 世界：${spec.world.name} · ${spec.world.time}\n- 角色：${spec.player.role}\n- 总时长：${spec.format.durationSeconds}s\n- 落地页：\`${spec.publish.landingPath}\`\n\n## 时间线\n\n| # | 时间 | 模块 | 屏幕文案 | 画面要求 | 转场 | 音频 |\n|---:|---|---|---|---|---|---|\n${rows}\n\n## 校验警告\n\n${validation.warnings.length ? validation.warnings.map((item)=>`- ${item}`).join("\n") : "- 无。"}\n`;
}

function srt(scenes) { return scenes.map((scene, index) => `${index+1}\n${tc(scene.start)} --> ${tc(scene.end)}\n${scene.copy.join("\n")}\n`).join("\n"); }
function edl(scenes) {
  const header = "scene,module,start,end,duration_seconds,on_screen_copy,visual_direction,asset,transition,audio_cue";
  return `${header}\n${scenes.map((scene)=>[scene.index,scene.id,tc(scene.start,":"),tc(scene.end,":"),scene.duration,scene.copy.join(" / "),scene.visual,scene.asset,scene.transition,scene.audio].map(csv).join(",")).join("\n")}\n`;
}
function checklist(spec) {
  const rows = [["Hook",spec.assets.hookImage],[...[]]].slice(0,1);
  const items = [["Hook fate image",spec.assets.hookImage],...spec.assets.rewindImages.map((item,i)=>[`Rewind ${i+1}`,item]),["Player portrait",spec.assets.playerPortrait],...spec.assets.conflictPortraits.map((item,i)=>[`Conflict portrait ${i+1}`,item]),...spec.assets.consequencePortraits.map((item,i)=>[`Consequence portrait ${i+1}`,item]),["World image",spec.assets.worldImage],["Game UI",spec.assets.gameUiImage],["Logo video",spec.assets.logoVideo]];
  return `# ${spec.videoId} 资产清单\n\n| 状态 | 资产 | 目标路径 |\n|---|---|---|\n${items.map(([name,target])=>`| ☐ | ${name} | \`${target}\` |`).join("\n")}\n\n- 静态图至少 1080 × 1920；人物优先透明 PNG。\n- 危机画面使用象征性、非血腥表达。\n- 至少一镜使用真实或忠实复刻的产品选择 UI。\n`;
}

async function write(output, name, content) {
  const target = path.join(output, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { path: name.replaceAll(path.sep,"/"), bytes: Buffer.byteLength(content), sha256: hash(content) };
}

export async function generateVideoKit(spec, outputDir, options = {}) {
  const validation = validateSpec(spec, options);
  if (validation.errors.length) throw new Error(`Invalid video spec:\n- ${validation.errors.join("\n- ")}`);
  const scenes = sceneDraft(spec);
  if (options.clean !== false) await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const files = [];
  for (const scene of scenes) files.push(await write(outputDir, `frames/${String(scene.index).padStart(2,"0")}-${scene.id}.svg`, renderFrameSvg(spec, scene)));
  const p = spec.brand.palette;
  const sheet = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1260" height="5400" viewBox="0 0 1260 5400"><rect width="1260" height="5400" fill="${p.paper}"/><text x="70" y="90" font-family="Inter,Arial,sans-serif" font-size="46" font-weight="900" fill="${p.ink}">${xml(spec.series)} — ${xml(spec.videoId)}</text>${scenes.map((scene,index)=>{const col=index%2,row=Math.floor(index/2),x=70+col*605,y=160+row*1030;return `<rect x="${x}" y="${y}" width="550" height="970" rx="34" fill="${p.ink}" opacity=".94"/><text x="${x+35}" y="${y+70}" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="850" fill="${p.accentSoft}">${String(scene.index).padStart(2,"0")} · ${xml(scene.label)}</text>${svgText(scene.copy.slice(0,4),y+500,37,p.paper,22).replaceAll('x="540"',`x="${x+275}"`)}</rect>`;}).join("")}</svg>`;
  files.push(await write(outputDir, "contact-sheet.svg", sheet));
  files.push(await write(outputDir, "storyboard.md", storyboard(spec, scenes, validation)));
  files.push(await write(outputDir, "subtitles.srt", srt(scenes)));
  files.push(await write(outputDir, "edit-decision-list.csv", edl(scenes)));
  files.push(await write(outputDir, "asset-checklist.md", checklist(spec)));
  const manifest = { generator: "Our Many Worlds MVP Video Kit", generatorVersion: "1.0.0", generatedAt: new Date().toISOString(), videoId: spec.videoId, sourceSpecSha256: hash(`${JSON.stringify(spec,null,2)}\n`), durationSeconds: spec.format.durationSeconds, sceneCount: scenes.length, warnings: validation.warnings, files };
  const manifestContent = `${JSON.stringify(manifest,null,2)}\n`;
  await write(outputDir, "manifest.json", manifestContent);
  return { validation, scenes, files: [...files, { path: "manifest.json", bytes: Buffer.byteLength(manifestContent), sha256: hash(manifestContent) }] };
}

