from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# Expose the compact event shape used by Narrator/validation context.
path = Path("apps/api/src/solo-story-engine/types.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''export type ContextSection<T> = { items: T[]; tokenEstimate: number };

export type CompiledStoryContext = {''',
    '''export type ContextSection<T> = { items: T[]; tokenEstimate: number };

/**
 * Current-settlement facts visible to foreground generation and validation.
 * Next-decision routing, candidate traces and state patches are intentionally
 * absent: Settlement owns the current result; nextWorkingSet owns only the
 * following decision surface.
 */
export type PartOneSettlementPromptProjection = Pick<
  PartOneActionSettlement["event"],
  | "eventId"
  | "turnNumber"
  | "sectionIdBefore"
  | "sectionIdAfter"
  | "actionSource"
  | "decisionKernelId"
  | "affordanceTemplateId"
  | "actionText"
  | "targetRef"
  | "authoritativeObservableFacts"
  | "authoritativeNpcReactions"
  | "sceneBefore"
  | "sceneAfter"
  | "authoritativeWorldMoves"
  | "narrativePlan"
  | "sectionTransitioned"
>;

export type CompiledStoryContext = {''',
    "prompt projection type",
)
text = replace_once(
    text,
    '''    partOneSettlement: ContextSection<PartOneActionSettlement["event"]>;
''',
    '''    partOneSettlement: ContextSection<PartOneSettlementPromptProjection>;
''',
    "compiled context settlement type",
)
path.write_text(text, encoding="utf-8")

path = Path("apps/api/src/solo-story-engine/context-compiler.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  PendingConsequence,
  RecentCanonEntry,
  ScriptCard,''',
    '''  PendingConsequence,
  PartOneSettlementPromptProjection,
  RecentCanonEntry,
  ScriptCard,''',
    "compiler projection import",
)
text = replace_once(
    text,
    '''    partOneRuntime: { items: input.partOneRuntime ? [input.partOneRuntime] : [], tokenEstimate: estimateJsonTokens(input.partOneRuntime ? [input.partOneRuntime] : []) },
    partOneSettlement: { items: input.partOneSettlement ? [input.partOneSettlement.event] : [], tokenEstimate: estimateJsonTokens(input.partOneSettlement ? [input.partOneSettlement.event] : []) }
  };''',
    '''    partOneRuntime: { items: input.partOneRuntime ? [input.partOneRuntime] : [], tokenEstimate: estimateJsonTokens(input.partOneRuntime ? [input.partOneRuntime] : []) },
    partOneSettlement: {
      items: input.partOneSettlement
        ? [partOneSettlementPromptProjection(input.partOneSettlement.event)]
        : [],
      tokenEstimate: estimateJsonTokens(
        input.partOneSettlement
          ? [partOneSettlementPromptProjection(input.partOneSettlement.event)]
          : [],
      ),
    }
  };''',
    "project settlement source section",
)
text = replace_once(
    text,
    '''  partOneRuntime: import("@ai-story/templates").PartOneRuntimeWorkingSet | null;
  partOneSettlement: import("@ai-story/templates").PartOneCommittedEvent | null;
  playerAction: { userFacingText: string } | null;''',
    '''  partOneRuntime: import("@ai-story/templates").PartOneRuntimeWorkingSet | null;
  partOneSettlement: PartOneSettlementPromptProjection | null;
  playerAction: { userFacingText: string } | null;''',
    "render working set settlement type",
)
marker = '''function partOnePromptProjection(item: import("@ai-story/templates").PartOneRuntimeWorkingSet) {'''
projection = '''function partOneSettlementPromptProjection(
  item: import("@ai-story/templates").PartOneCommittedEvent,
): PartOneSettlementPromptProjection {
  return {
    eventId: item.eventId,
    turnNumber: item.turnNumber,
    sectionIdBefore: item.sectionIdBefore,
    sectionIdAfter: item.sectionIdAfter,
    actionSource: item.actionSource,
    decisionKernelId: item.decisionKernelId,
    affordanceTemplateId: item.affordanceTemplateId,
    actionText: item.actionText,
    targetRef: item.targetRef,
    authoritativeObservableFacts: item.authoritativeObservableFacts,
    authoritativeNpcReactions: item.authoritativeNpcReactions,
    sceneBefore: item.sceneBefore,
    sceneAfter: item.sceneAfter,
    authoritativeWorldMoves: item.authoritativeWorldMoves,
    narrativePlan: item.narrativePlan,
    sectionTransitioned: item.sectionTransitioned,
  };
}

'''
if marker not in text:
    raise SystemExit("settlement projection insertion point missing")
text = text.replace(marker, projection + marker, 1)
path.write_text(text, encoding="utf-8")

# The transition regression must test the surfaced authored Pair rather than
# assume a particular option ID is selected by Outcome diversity.
path = Path("packages/templates/tests/part-one-dynamic-kernel-lite.test.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  const chosen = current.decisionAffordances.find((affordance) => (
    affordance.affordanceTemplateId
      === "DK-P1-RESPONSIBILITY-RECORD-OPT-03"
  ));''',
    '''  const chosen = current.decisionAffordances.find((affordance) => (
    Boolean(affordance.playerVisibleFallback?.SCENE_TRANSITION)
  ));''',
    "transition test selected authored surface",
)
path.write_text(text.rstrip() + "\n", encoding="utf-8")
