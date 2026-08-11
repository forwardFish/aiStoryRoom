import { PressureKernelError } from "./errors";
import type { PressureBranchLevel, PressureContentNode, SelectorAtom, SelectorRule } from "./types";

function minExpression(expression: string, state: Record<string, unknown>): number | null {
  const match = /^min\(([^)]+)\)$/u.exec(expression.replace(/\s+/gu, ""));
  if (!match) return null;
  const keys = match[1].split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!keys.length) return null;
  const values = keys.map((key) => Number(state[key]));
  return values.every(Number.isFinite) ? Math.min(...values) : null;
}

function valueForAtom(atom: SelectorAtom, state: Record<string, unknown>): unknown {
  if (atom.key) return state[atom.key];
  if (atom.expr) {
    const min = minExpression(atom.expr, state);
    if (min !== null) return min;
  }
  return undefined;
}

function compare(actual: unknown, op: SelectorAtom["op"], expected: unknown): boolean {
  switch (op) {
    case "==": return actual === expected;
    case "!=": return actual !== expected;
    case ">=": return Number(actual) >= Number(expected);
    case ">": return Number(actual) > Number(expected);
    case "<=": return Number(actual) <= Number(expected);
    case "<": return Number(actual) < Number(expected);
    case "IN": return Array.isArray(expected) && expected.includes(actual);
    case "NOT_IN": return Array.isArray(expected) && !expected.includes(actual);
    default: return false;
  }
}

export function evaluateSelectorRule(rule: SelectorRule, state: Record<string, unknown>): boolean {
  if ("otherwise" in rule) return true;
  if ("all" in rule) return rule.all.every((child) => evaluateSelectorRule(child, state));
  if ("any" in rule) return rule.any.some((child) => evaluateSelectorRule(child, state));
  return compare(valueForAtom(rule, state), rule.op, rule.value);
}

export function selectPressureBranch(node: PressureContentNode, state: Record<string, unknown>) {
  if (node.nodeId === "P0") {
    const branch = node.branches[0];
    if (!branch) throw new PressureKernelError("CONTENT_IMPORT_INVALID", "P0 has no locked branch");
    return branch;
  }
  for (const level of node.branchEvaluationOrder) {
    const selector = node.branchSelectors[level];
    if (selector && evaluateSelectorRule(selector, state)) {
      const branch = node.branches.find((candidate) => candidate.level === level);
      if (!branch) throw new PressureKernelError("CONTENT_IMPORT_INVALID", `Missing ${level} branch for ${node.nodeId}`);
      return branch;
    }
  }
  const fallback = node.branches.find((candidate) => candidate.branchId === node.defaultBranchId);
  if (!fallback) throw new PressureKernelError("CONTENT_IMPORT_INVALID", `No selector/default branch for ${node.nodeId}`);
  return fallback;
}

export function branchLevelForId(node: PressureContentNode, branchId: string): PressureBranchLevel {
  const branch = node.branches.find((candidate) => candidate.branchId === branchId);
  if (!branch) throw new PressureKernelError("CONTENT_IMPORT_INVALID", `Unknown branch ${branchId}`);
  return branch.level;
}
