import type { CausalEvent, VisibilityRule } from "./types";

export class EventContextValidator {
  readonly events: ReadonlyMap<string, CausalEvent>;
  constructor(inputs: readonly unknown[], validate: (input: unknown, prior: readonly CausalEvent[]) => CausalEvent) {
    const validated: CausalEvent[] = []; const map = new Map<string, CausalEvent>();
    for (const input of inputs) {
      const event = validate(input, validated);
      if (map.has(event.eventId)) throw new Error(`EVENT_ID_DUPLICATE:${event.eventId}`);
      map.set(event.eventId, event); validated.push(event);
    }
    this.events = map;
  }
  require(eventId: string): CausalEvent { const event = this.events.get(eventId); if (!event) throw new Error(`DANGLING_EVENT:${eventId}`); return event; }
}

export function validateInferableEvidence(
  visibility: VisibilityRule,
  current: { eventId: string; runId: string; createdAtRevision: number },
  context: EventContextValidator,
): void {
  if (visibility.scope !== "INFERABLE") return;
  for (const evidenceId of visibility.evidenceEventIds) {
    if (evidenceId === current.eventId) throw new Error(`VISIBILITY_EVIDENCE_SELF_REFERENCE:${evidenceId}`);
    const evidence = context.require(evidenceId);
    if (evidence.visibility.scope !== "PUBLIC") throw new Error(`VISIBILITY_EVIDENCE_NOT_PUBLIC:${evidenceId}`);
    if (evidence.status !== "APPLIED") throw new Error(`VISIBILITY_EVIDENCE_NOT_APPLIED:${evidenceId}`);
    if (evidence.runId !== current.runId) throw new Error(`VISIBILITY_EVIDENCE_RUN_MISMATCH:${evidenceId}`);
    if (evidence.createdAtRevision > current.createdAtRevision) throw new Error(`VISIBILITY_EVIDENCE_FROM_FUTURE:${evidenceId}`);
  }
}
