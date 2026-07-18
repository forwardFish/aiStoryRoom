import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const webUi = join(root, "docs", "UI", "web");
const destination = join(root, "apps", "web", "public", "assets");
const webPublic = join(root, "apps", "web", "public");
const vercelOutput = join(root, "apps", "web", "dist-vercel");

const pngFiles = async (directory) => (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));

async function resetDirectory(path) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

async function copyIndexed(sourceDirectory, names, targetDirectory) {
  await resetDirectory(targetDirectory);
  await Promise.all(names.map((name, index) => cp(join(sourceDirectory, name), join(targetDirectory, `${index + 1}.png`))));
}

async function copyNamed(sourceDirectory, sourceName, targetDirectory, targetName) {
  if (!sourceName) throw new Error(`missing required supplied asset: ${targetName}`);
  await mkdir(targetDirectory, { recursive: true });
  await cp(join(sourceDirectory, sourceName), join(targetDirectory, targetName));
}

const picDirectory = join(webUi, "pic");
const pictures = await pngFiles(picDirectory);
const backgrounds = pictures.filter((name) => name.includes("22_46_") || name.includes("22_54_44") || name.includes("22_54_45"));
const portraits = pictures.filter((name) => name.includes("22_49_") || (name.includes("22_54_4") && !name.includes("22_54_44") && !name.includes("22_54_45")));
await copyIndexed(picDirectory, backgrounds, join(destination, "bg"));
await copyIndexed(picDirectory, portraits, join(destination, "portrait"));

// Payment and invitation surfaces deliberately use the user's latest
// purpose-made transparent assets rather than substituting generic emojis.
await copyNamed(picDirectory, pictures.find((name) => name.includes("21_59_15 (4)")), join(destination, "payment"), "credits-stack.png");
await copyNamed(picDirectory, pictures.find((name) => name.includes("21_59_13 (2)")), join(destination, "social"), "telegram.png");
await copyNamed(picDirectory, pictures.find((name) => name.includes("21_59_16 (5)")), join(destination, "social"), "qr.png");
// This supplied composition contains the pale floating castle on its right,
// matching the payment unlock context while the poster keeps its full scene.
await copyNamed(picDirectory, pictures.find((name) => name.includes("20_10_29")), join(destination, "payment"), "unlock-world.png");

// The invite poster has a dedicated blank composition. Keep it separate from
// room backgrounds so the generated QR and room data can remain dynamic.
const invitePosterBackground = "ChatGPT Image 2026年7月14日 20_10_29.png";
const posterDestination = join(destination, "poster");
await resetDirectory(posterDestination);
await cp(join(picDirectory, invitePosterBackground), join(posterDestination, "invite-background.png"));

const iconDirectory = join(webUi, "icon", "many-worlds-icons-clean", "png-tight");
await copyIndexed(iconDirectory, await pngFiles(iconDirectory), join(destination, "icon"));

const gameParent = join(webUi, "game");
const gameDirectoryName = (await readdir(gameParent, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .find((name) => existsSync(join(gameParent, name)));
if (!gameDirectoryName) throw new Error("missing supplied game asset directory");
const gameDirectory = join(gameParent, gameDirectoryName);
const gameFiles = await pngFiles(gameDirectory);
const gameKeys = ["background", "governor", "many-worlds", "palace", "treasury", "heart", "grain", "sprout", "crown", "minister", "magistrate", "clerk", "merchant", "spy", "network", "rank", "shield", "eye"];
if (gameFiles.length < gameKeys.length) throw new Error(`expected ${gameKeys.length} game assets, found ${gameFiles.length}`);
const gameDestination = join(destination, "game", "sangtian");
await mkdir(gameDestination, { recursive: true });
await Promise.all(gameKeys.map((key, index) => cp(join(gameDirectory, gameFiles[index]), join(gameDestination, `${key}.png`))));

// Production currently exposes the lobby first. Keep the local game entry
// untouched and create a separate deploy-only output where / is the homepage.
await resetDirectory(vercelOutput);
await cp(webPublic, vercelOutput, { recursive: true });
// Keep index.html as the formal game entry. Vercel rewrites / to home.html.
await writeFile(
  join(vercelOutput, "runtime-config.js"),
  `window.__MANY_WORLDS_RUNTIME__ = { googleWebClientId: ${JSON.stringify(String(process.env.PUBLIC_GOOGLE_WEB_CLIENT_ID || "").trim())} };\n`
);

console.log(JSON.stringify({
  status: "PASS",
  generated: { backgrounds: backgrounds.length, portraits: portraits.length, icons: (await pngFiles(iconDirectory)).length, gameAssets: gameKeys.length, staticOutput: "apps/web/dist-vercel" }
}));
