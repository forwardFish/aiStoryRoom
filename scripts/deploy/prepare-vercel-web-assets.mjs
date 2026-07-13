import { cp, mkdir, readdir, rm } from "node:fs/promises";
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

const picDirectory = join(webUi, "pic");
const pictures = await pngFiles(picDirectory);
const backgrounds = pictures.filter((name) => name.includes("22_46_") || name.includes("22_54_44") || name.includes("22_54_45"));
const portraits = pictures.filter((name) => name.includes("22_49_") || (name.includes("22_54_4") && !name.includes("22_54_44") && !name.includes("22_54_45")));
await copyIndexed(picDirectory, backgrounds, join(destination, "bg"));
await copyIndexed(picDirectory, portraits, join(destination, "portrait"));

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
await cp(join(vercelOutput, "home.html"), join(vercelOutput, "index.html"));

console.log(JSON.stringify({
  status: "PASS",
  generated: { backgrounds: backgrounds.length, portraits: portraits.length, icons: (await pngFiles(iconDirectory)).length, gameAssets: gameKeys.length, staticOutput: "apps/web/dist-vercel" }
}));
