import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export async function ensureDir(directory: string) {
  await mkdir(directory, { recursive: true });
}

export async function readText(file: string, fallback = "") {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  const text = await readText(file, "");
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function writeAtomic(file: string, content: string) {
  await ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rename(temporary, file);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EPERM", "EACCES", "EBUSY"].includes(String(code))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 8 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function writeJsonAtomic(file: string, value: unknown) {
  await writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function appendText(file: string, content: string) {
  await ensureDir(path.dirname(file));
  await appendFile(file, content, "utf8");
}

export async function appendJsonl(file: string, value: unknown) {
  await appendText(file, `${JSON.stringify(value)}\n`);
}

export async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export function safeRunId(value: string) {
  const runId = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(runId)) {
    throw new Error("runId must contain 6-128 letters, digits, underscores, or hyphens");
  }
  return runId;
}

export function compactText(value: unknown, maxChars: number) {
  const text = String(value ?? "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function stripMarkdownHeading(value: string) {
  return String(value || "")
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^#{1,6}\s+[^\n]+\n+/, "")
    .trim();
}
