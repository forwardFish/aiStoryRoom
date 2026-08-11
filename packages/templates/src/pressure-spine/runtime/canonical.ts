import { canonicalJson, sha256Bytes } from "../canonical";
import type { PressureRuntimeState } from "./types";

export function pressureHash(value: unknown): string {
  return sha256Bytes(canonicalJson(value));
}

export function stableId(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  return `${prefix}.${pressureHash(parts.map((part) => String(part ?? ""))).slice(0, 24).toLowerCase()}`;
}

export function clonePressureValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export function isoFromEpoch(epochMs: number): string {
  return new Date(Math.max(0, Math.trunc(epochMs))).toISOString();
}

export function deterministicStateView(state: PressureRuntimeState): unknown {
  return {
    ...state,
    rootEvents: state.rootEvents.map(({ createdAt: _createdAt, ...event }) => event),
    sealedActions: Object.fromEntries(Object.entries(state.sealedActions).map(([id, action]) => [id, {
      ...action,
      sealedAt: "<logical>",
      resolvedAt: action.resolvedAt ? "<logical>" : null,
    }])),
    frozenResults: state.frozenResults.map((result) => ({ ...result, frozenAt: "<logical>" })),
    checkpoints: Object.fromEntries(Object.entries(state.checkpoints).map(([key, value]) => [key, {
      ...value,
      completedAt: "<logical>",
    }])),
    failure: state.failure ? { ...state.failure, failedAt: "<logical>" } : null,
  };
}

export function pressureStateHash(state: PressureRuntimeState): string {
  return pressureHash(deterministicStateView(state));
}
