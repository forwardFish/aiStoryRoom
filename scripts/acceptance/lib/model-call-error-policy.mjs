const RECOVERED_NARRATIVE_OWNERS = new Set([
  "FALLBACK",
  "PROTECTED_RENDERER",
]);

function turnKey(value) {
  return String(value || "").trim();
}

function successfulCallExists(calls, turnId, stage) {
  return calls.some((call) => (
    turnKey(call.turnId) === turnId
    && call.stage === stage
    && !call.error
  ));
}

/**
 * Separate provider failures recovered by the runtime contract from failures
 * that still invalidate acceptance. The policy uses structured stage outcomes
 * and committed dispositions, never story text or language-specific keywords.
 */
export function classifyModelCallErrors({ modelCalls, turns, storykeeper }) {
  const calls = Array.isArray(modelCalls) ? modelCalls : [];
  const committedTurns = new Map(
    (Array.isArray(turns) ? turns : []).map((turn) => [turnKey(turn.turnId), turn]),
  );
  const storykeeperApplied = new Set(
    (Array.isArray(storykeeper?.applied) ? storykeeper.applied : []).map(turnKey),
  );
  const storykeeperDeadLetters = new Set(
    (Array.isArray(storykeeper?.deadLetters) ? storykeeper.deadLetters : []).map(turnKey),
  );
  const recovered = [];
  const unexpected = [];

  for (const call of calls.filter((candidate) => candidate?.error)) {
    const turnId = turnKey(call.turnId);
    const committedTurn = committedTurns.get(turnId);
    let recovery = null;

    if (call.stage === "narrator") {
      if (successfulCallExists(calls, turnId, "narrator")) {
        recovery = "LATER_NARRATOR_ATTEMPT_SUCCEEDED";
      } else if (
        committedTurn
        && (
          RECOVERED_NARRATIVE_OWNERS.has(String(committedTurn.narrativeOwner || ""))
          || Boolean(committedTurn.fallbackReason)
        )
        && String(committedTurn.narrative || "").trim().length > 0
      ) {
        recovery = "COMMITTED_SAFE_NARRATIVE_FALLBACK";
      }
    } else if (call.stage === "storykeeper") {
      if (storykeeperApplied.has(turnId) && !storykeeperDeadLetters.has(turnId)) {
        recovery = "STORYKEEPER_EVENTUALLY_APPLIED";
      }
    }

    const classified = { ...call, recovery };
    if (recovery) recovered.push(classified);
    else unexpected.push(classified);
  }

  return { recovered, unexpected };
}
