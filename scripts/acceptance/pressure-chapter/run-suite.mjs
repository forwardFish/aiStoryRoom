#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { getPressureChapterSuite } from './suite-definitions.mjs';

const GLOB_MAGIC = /[*?]/;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage', '.turbo', '.next']);

function normalizeSlashes(value) {
  return value.replaceAll('\\', '/');
}

function escapeRegex(character) {
  return /[\\^$+?.()|{}\[\]]/.test(character) ? `\\${character}` : character;
}

export function globToRegExp(glob) {
  const normalized = normalizeSlashes(glob);
  let expression = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        index += 1;
        if (normalized[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += escapeRegex(character);
    }
  }
  return new RegExp(`${expression}$`, 'u');
}

function staticRootForGlob(glob) {
  const normalized = normalizeSlashes(glob);
  const magicIndex = normalized.search(GLOB_MAGIC);
  if (magicIndex < 0) return path.posix.dirname(normalized);
  const prefix = normalized.slice(0, magicIndex);
  const slashIndex = prefix.lastIndexOf('/');
  return slashIndex < 0 ? '.' : prefix.slice(0, slashIndex) || '.';
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function walkFiles(repoRoot, relativeDirectory, output) {
  const absoluteDirectory = path.resolve(repoRoot, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relativePath = normalizeSlashes(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      await walkFiles(repoRoot, relativePath, output);
    } else if (entry.isFile()) {
      output.push(relativePath.replace(/^\.\//, ''));
    }
  }
}

export async function expandGlobs(repoRoot, globs, excludeGlobs = []) {
  const matches = new Set();
  const excludePatterns = excludeGlobs.map(globToRegExp);
  for (const glob of globs) {
    const normalized = normalizeSlashes(glob).replace(/^\.\//, '');
    if (!GLOB_MAGIC.test(normalized)) {
      if (await isFile(path.resolve(repoRoot, normalized))) matches.add(normalized);
      continue;
    }
    const candidates = [];
    await walkFiles(repoRoot, staticRootForGlob(normalized), candidates);
    const pattern = globToRegExp(normalized);
    for (const candidate of candidates) {
      if (pattern.test(candidate) && !excludePatterns.some((exclude) => exclude.test(candidate))) matches.add(candidate);
    }
  }
  return [...matches].sort((left, right) => left.localeCompare(right, 'en'));
}

function checkEnvironmentRequirement(requirement, environment) {
  const names = requirement.oneOf ?? [requirement.name];
  const values = names.map((name) => environment[name]);
  if (requirement.present === true && !values.some((value) => typeof value === 'string' && value.length > 0)) {
    return `one of ${names.join(', ')} must be present`;
  }
  if (requirement.equals !== undefined && !values.some((value) => value === requirement.equals)) {
    return `${names.join(' or ')} must equal the required non-secret marker`;
  }
  if (requirement.matches !== undefined) {
    const pattern = new RegExp(requirement.matches, 'u');
    if (!values.some((value) => typeof value === 'string' && pattern.test(value))) {
      return `${names.join(' or ')} does not match the required format`;
    }
  }
  return null;
}

function resolveCommand(executable, args) {
  if (process.platform === 'win32' && executable === 'pnpm') {
    return {
      executable: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm', ...args],
    };
  }
  return { executable, args };
}

function expandStepArguments(step, files) {
  const argumentsList = [];
  for (const argument of step.args ?? []) {
    if (argument === '{files}') argumentsList.push(...files);
    else argumentsList.push(argument);
  }
  return argumentsList;
}

export async function prepareSuite({ suiteName, suite, repoRoot, environment = process.env }) {
  const issues = [];
  const preparedSteps = [];
  for (const requirement of suite.requiredEnvironment ?? []) {
    const issue = checkEnvironmentRequirement(requirement, environment);
    if (issue) issues.push({ id: 'MISSING_REQUIRED_ENVIRONMENT', detail: issue });
  }
  for (const forbidden of suite.forbiddenEnvironment ?? []) {
    const names = forbidden.oneOf ?? [forbidden.name];
    if (names.some((name) => environment[name] === forbidden.equals)) {
      issues.push({ id: 'FORBIDDEN_ENVIRONMENT', detail: `${names.join(' or ')} has a forbidden value` });
    }
  }

  for (const step of suite.steps ?? []) {
    const files = step.globs ? await expandGlobs(repoRoot, step.globs, step.excludeGlobs ?? []) : [];
    if (step.globs && files.length < (step.minMatches ?? 1)) {
      issues.push({
        id: 'MISSING_TESTS',
        stepId: step.id,
        detail: `expected at least ${step.minMatches ?? 1} matching test file(s); found ${files.length}`,
        globs: step.globs,
      });
    }
    const command = resolveCommand(step.executable, expandStepArguments(step, files));
    preparedSteps.push({
      id: step.id,
      executable: command.executable,
      args: command.args,
      cwd: step.cwd ?? '.',
      environment: { ...(step.environment ?? {}) },
      files,
      timeoutMs: step.timeoutMs ?? 15 * 60 * 1000,
    });
  }
  const hasHardFailure = issues.some((issue) => issue.id !== 'MISSING_REQUIRED_ENVIRONMENT');
  const hasEnvironmentBlocker = issues.some((issue) => issue.id === 'MISSING_REQUIRED_ENVIRONMENT');
  return {
    schemaVersion: 'pressure-chapter-suite-plan-v1',
    suite: suiteName,
    status: hasHardFailure
      ? 'FAIL'
      : hasEnvironmentBlocker
        ? 'BLOCKED_BY_ENVIRONMENT'
        : 'READY_NOT_RUN',
    issues,
    steps: preparedSteps,
  };
}

function defaultSpawn(executable, args, options) {
  return spawnSync(executable, args, options);
}

export async function runPreparedSuite({ plan, repoRoot, environment = process.env, spawn = defaultSpawn }) {
  if (plan.status !== 'READY_NOT_RUN') {
    return { ...plan, phase: 'PREFLIGHT', childResults: [] };
  }
  const childResults = [];
  for (const step of plan.steps) {
    const cwd = path.resolve(repoRoot, step.cwd);
    const relativeCwd = path.relative(path.resolve(repoRoot), cwd);
    if (relativeCwd.startsWith('..') || path.isAbsolute(relativeCwd)) {
      return {
        ...plan,
        status: 'FAIL',
        phase: 'EXECUTION',
        issues: [{ id: 'INVALID_CWD', stepId: step.id, detail: 'step cwd escapes the repository' }],
        childResults,
      };
    }
    process.stdout.write(`[pressure-chapter] ${plan.suite}/${step.id}\n`);
    const result = spawn(step.executable, step.args, {
      cwd,
      env: { ...environment, ...(step.environment ?? {}) },
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      maxBuffer: 16 * 1024 * 1024,
      timeout: step.timeoutMs,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    const child = {
      stepId: step.id,
      exitCode: Number.isInteger(result.status) ? result.status : null,
      signal: result.signal ?? null,
      errorCode: result.error?.code ?? null,
    };
    childResults.push(child);
    if (result.error || result.status !== 0) {
      return {
        ...plan,
        status: 'FAIL',
        phase: 'EXECUTION',
        issues: [{
          id: result.error ? 'CHILD_PROCESS_ERROR' : 'CHILD_PROCESS_FAILED',
          stepId: step.id,
          detail: result.error ? `child could not start (${result.error.code ?? 'unknown'})` : `child exited ${result.status}`,
        }],
        childResults,
      };
    }
  }
  return { ...plan, status: 'PASS', phase: 'COMPLETE', issues: [], childResults };
}

export async function runSuite({ suiteName, suite, repoRoot, environment = process.env, spawn = defaultSpawn, planOnly = false }) {
  const plan = await prepareSuite({ suiteName, suite, repoRoot, environment });
  if (planOnly || plan.status !== 'READY_NOT_RUN') return { ...plan, phase: 'PREFLIGHT', childResults: [] };
  return runPreparedSuite({ plan, repoRoot, environment, spawn });
}

function parseCli(argv) {
  let suiteName = null;
  let repoRoot = null;
  let planOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--suite') {
      suiteName = argv[index + 1];
      index += 1;
    } else if (token === '--repo-root') {
      repoRoot = argv[index + 1];
      index += 1;
    } else if (token === '--plan') {
      planOnly = true;
    } else if (!token.startsWith('-') && suiteName === null) {
      suiteName = token;
    } else {
      throw new Error(`Unexpected argument: ${token}`);
    }
  }
  if (!suiteName) throw new Error('Suite name is required.');
  return { suiteName, repoRoot, planOnly };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const suite = getPressureChapterSuite(options.suiteName);
  if (!suite) throw new Error(`Unknown Pressure Chapter suite: ${options.suiteName}`);
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : process.cwd();
  const result = await runSuite({ suiteName: options.suiteName, suite, repoRoot, planOnly: options.planOnly });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'PASS') process.exitCode = 0;
  else if (result.status === 'BLOCKED_BY_ENVIRONMENT') process.exitCode = 3;
  else if (result.status === 'READY_NOT_RUN') process.exitCode = 4;
  else process.exitCode = 1;
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 2;
  });
}
