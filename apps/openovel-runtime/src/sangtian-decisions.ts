import path from "node:path";
import templatesPackage from "@ai-story/templates";
import {
  type PartOneActionSettlement,
  type PartOneIncomingAction,
  type PartOneRuntimeAffordance,
  type PartOneRuntimePackage,
  type PartOneState,
} from "@ai-story/templates";
import { appendJsonl, readJson, writeJsonAtomic } from "./io.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type { OpenNovelOption } from "./types.js";

const {
  buildPartOneRuntimeWorkingSet,
  finalizePartOneSettlement,
  loadPartOneRuntimePackage,
  settlePartOneAction,
} = templatesPackage;

export type PreparedSangtianDecision = {
  package: PartOneRuntimePackage;
  settlement: PartOneActionSettlement;
  selectedOption: OpenNovelOption | null;
};

export async function prepareSangtianDecision(
  workspace: FileStoryWorkspace,
  input: {
    runId: string;
    turnNumber: number;
    action: string;
    selectedOption: OpenNovelOption | null;
  },
): Promise<PreparedSangtianDecision | null> {
  const metadata = await workspace.metadata(input.runId);
  if (metadata.worldId !== "sangtian" || metadata.roleId !== "zhejiang_governor") {
    return null;
  }
  const paths = workspace.paths(input.runId);
  const pkg = partOnePackage(workspace.projectRoot);
  const state = await readJson<PartOneState | null>(paths.partOneState, null);
  if (!state) throw new Error("SANGTIAN_PART_ONE_STATE_MISSING");

  const incoming = bindIncomingAction(
    pkg,
    state,
    input.turnNumber,
    input.action,
    input.selectedOption,
  );
  const settlement = settlePartOneAction(pkg, state, incoming, input.turnNumber);
  if (
    input.selectedOption
    && !input.selectedOption.id.startsWith("opening_")
    && !input.selectedOption.id.startsWith("opt_")
    && !settlement.appliedAffordance
  ) {
    throw new Error("SANGTIAN_AUTHORED_AFFORDANCE_BINDING_FAILED");
  }
  return {
    package: pkg,
    settlement,
    selectedOption: input.selectedOption
      ? withNarrativeContract(input.selectedOption, settlement)
      : null,
  };
}

export async function commitSangtianDecision(
  workspace: FileStoryWorkspace,
  runId: string,
  prepared: PreparedSangtianDecision,
  publishedNarration: string,
) {
  const paths = workspace.paths(runId);
  // A consequence may be paid only after its required visible terms actually
  // reached Canon. This keeps the state ledger from silently advancing a
  // countermove that the player never saw.
  const paidConsequenceIds = prepared.settlement.event.authoritativeWorldMoves
    .filter((move) => (
      move.sourceType === "DUE_CONSEQUENCE"
      && move.consequenceId
      && move.requiredTermGroups.every((group) => (
        group.some((term) => publishedNarration.includes(term.replace(/^EXACT:/u, "")))
      ))
    ))
    .map((move) => move.consequenceId!);
  const finalized = finalizePartOneSettlement(
    prepared.settlement,
    paidConsequenceIds,
  );
  prepared.settlement = finalized;
  await writeJsonAtomic(paths.partOneState, finalized.proposedState);
  await appendJsonl(paths.partOneEvents, finalized.event);
}

export function nextSangtianOptions(
  prepared: PreparedSangtianDecision,
): OpenNovelOption[] {
  const state = prepared.settlement.proposedState;
  const nextTurnNumber = prepared.settlement.event.turnNumber + 1;
  const workingSet = buildPartOneRuntimeWorkingSet(
    prepared.package,
    state,
    prepared.settlement.event.turnNumber,
  );
  return workingSet.decisionAffordances.map((affordance) =>
    optionForAffordance(
      prepared.package,
      state,
      affordance,
      nextTurnNumber,
    )
  );
}

export async function currentSangtianOptions(
  workspace: FileStoryWorkspace,
  runId: string,
): Promise<OpenNovelOption[] | null> {
  const metadata = await workspace.metadata(runId);
  if (metadata.worldId !== "sangtian" || metadata.roleId !== "zhejiang_governor") {
    return null;
  }
  const paths = workspace.paths(runId);
  const state = await readJson<PartOneState | null>(paths.partOneState, null);
  if (!state) return null;
  const pkg = partOnePackage(workspace.projectRoot);
  const workingSet = buildPartOneRuntimeWorkingSet(pkg, state, metadata.turnNumber);
  return workingSet.decisionAffordances.map((affordance) =>
    optionForAffordance(pkg, state, affordance, metadata.turnNumber + 1)
  );
}

function bindIncomingAction(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  actionText: string,
  selectedOption: OpenNovelOption | null,
): PartOneIncomingAction {
  if (selectedOption?.id.startsWith("opening_")) {
    return {
      source: "RECOMMENDED",
      decisionId: selectedOption.id,
      actionText,
    };
  }
  if (selectedOption?.id.startsWith("opt_")) {
    return {
      source: "FREE_TEXT",
      actionText,
      targetRef: "public_frame",
    };
  }
  if (!selectedOption) {
    return {
      source: "FREE_TEXT",
      actionText,
      targetRef: "public_frame",
    };
  }
  const workingSet = buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    Math.max(0, turnNumber - 1),
  );
  const affordance = workingSet.decisionAffordances.find(
    (candidate) => candidate.affordanceTemplateId === selectedOption.id,
  );
  if (!affordance || affordance.actionText !== actionText) {
    throw new Error("SANGTIAN_STALE_OR_TAMPERED_AFFORDANCE");
  }
  return incomingForAffordance(affordance);
}

function incomingForAffordance(
  affordance: PartOneRuntimeAffordance,
): PartOneIncomingAction {
  return {
    source: "RECOMMENDED",
    decisionId: affordance.affordanceTemplateId,
    decisionKernelId: affordance.decisionKernelId,
    affordanceTemplateId: affordance.affordanceTemplateId,
    label: affordance.title,
    actionText: affordance.actionText,
    targetRef: affordance.target.id,
  };
}

function optionForAffordance(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  affordance: PartOneRuntimeAffordance,
  turnNumber: number,
): OpenNovelOption {
  const preview = settlePartOneAction(
    pkg,
    state,
    incomingForAffordance(affordance),
    turnNumber,
  );
  return withNarrativeContract(
    {
      id: affordance.affordanceTemplateId,
      // The page intentionally displays only the action a player can take.
      label: affordance.actionText,
      key: true,
      effect: {
        intent: affordance.immediateIntent,
        consequence: affordance.visibleTradeoff,
        reversible: false,
      },
    },
    preview,
  );
}

function withNarrativeContract(
  option: OpenNovelOption,
  settlement: PartOneActionSettlement,
): OpenNovelOption {
  const plan = settlement.event.narrativePlan;
  const requiredBeats = plan.sceneBeats.filter((beat) => beat.mustAppear);
  const hardRequiredGroups = requiredBeats
    .filter((beat) => beat.hardRequired)
    .flatMap((beat) => beat.requiredTermGroups);
  // The evidence profile owns opening_d1's narrower inquiry contract. The
  // authored state machine may still add an immediate NPC countermove that is
  // committed by the same turn. Merge that reaction into the evidence beat so
  // no authoritative event can exist backstage without appearing in Canon.
  if (option.id.startsWith("opening_") && option.effect?.beatContract) {
    const evidenceContract = option.effect.beatContract;
    const appendedBeats = requiredBeats.filter((beat) =>
      beat.sourceType === "NPC_REACTION"
      || beat.sourceType === "WORLD_MOVE"
    );
    return {
      ...option,
      effect: {
        ...option.effect,
        beatContract: {
          ...evidenceContract,
          moves: [
            ...(evidenceContract.moves || []),
            ...appendedBeats.map(renderNarrativeBeat),
          ],
          requiredAnchorGroups: mergeRequiredAnchorGroups(
            evidenceContract.requiredAnchorGroups || [],
            appendedBeats.flatMap((beat) => beat.requiredTermGroups),
          ),
          requiredDurableAnchorGroups: mergeRequiredAnchorGroups(
            evidenceContract.requiredDurableAnchorGroups || [],
            appendedBeats
              .filter((beat) => beat.hardRequired)
              .flatMap((beat) => beat.requiredTermGroups),
          ),
          constraints: [...new Set([
            ...(evidenceContract.constraints || []),
            ...plan.narrativeCeiling,
            ...plan.sceneBlocking,
            ...(plan.sceneEnd.documentStates || [])
              .map((item) => String(item.continuityNote || "").trim())
              .filter(Boolean),
          ])],
          stopCondition: appendedBeats.length
            ? plan.requiredEndChange
            : evidenceContract.stopCondition,
        },
      },
    };
  }
  const constraints = [...new Set([
    ...requiredBeats
      .filter((beat) => beat.sourceType === "PLAYER_ACTION")
      .map((beat) => String(beat.resultCeiling || "").trim())
      .filter((ceiling) => ceiling && !isGenericResultCeiling(ceiling)),
    ...plan.narrativeCeiling
      .map((item) => String(item || "").trim())
      .filter(Boolean),
    ...plan.sceneBlocking
      .map((item) => String(item || "").trim())
      .filter(Boolean),
    ...(plan.sceneEnd.documentStates || [])
      .map((item) => String(item.continuityNote || "").trim())
      .filter(Boolean),
  ])];
  return {
    ...option,
    effect: {
      ...option.effect,
      // The action remains player-facing. The Beat Contract owns the
      // implementation details and result ceiling, so the Narrator can stage
      // the action without inventing a second policy, document, or outcome.
      intent: settlement.event.actionText,
      beatContract: {
        sourceRef: `part-one-event:${settlement.event.eventId}`,
        objective: plan.dramaticTask,
        moves: requiredBeats.map(renderNarrativeBeat),
        requiredAnchorGroups: requiredBeats.flatMap(
          (beat) => beat.requiredTermGroups,
        ),
        requiredDurableAnchorGroups: hardRequiredGroups,
        settledNarrative: plan.settledActionNarrative,
        authorizedPlayerActions: requiredBeats
          .filter((beat) => beat.sourceType === "PLAYER_ACTION")
          .flatMap((beat) => [
            beat.action,
            String(beat.resultCeiling || "").trim(),
          ])
          .filter(Boolean),
        constraints,
        stopCondition: plan.requiredEndChange,
      },
    },
  };
}

function renderNarrativeBeat(
  beat: PartOneActionSettlement["event"]["narrativePlan"]["sceneBeats"][number],
) {
  const ceiling = String(beat.resultCeiling || "").trim();
  return ceiling && !isGenericResultCeiling(ceiling)
    ? `${beat.action}。具体兑现：${ceiling}`
    : beat.action;
}

function mergeRequiredAnchorGroups(
  existing: string[][],
  additions: string[][],
) {
  const merged = existing.map((group) => [...group]);
  const axes = new Set(merged.map(anchorGroupAxis).filter(Boolean));
  for (const group of additions) {
    const axis = anchorGroupAxis(group);
    if (axis && axes.has(axis)) continue;
    merged.push([...group]);
    if (axis) axes.add(axis);
  }
  return merged;
}

function anchorGroupAxis(group: string[]) {
  const text = group.join("\n");
  if (
    /(?:没有去拿印|朱印未动|公文暂压|公文往案|暂缓签发|暂不签发|扣下不签|未即刻签发|没有即刻签发|没有落印|没有碰印盒)/u
      .test(text)
  ) {
    return "SIGNATURE_WITHHELD";
  }
  return "";
}

function isGenericResultCeiling(ceiling: string) {
  return (
    /^只把这项已经结算的行动写清/u.test(ceiling)
    || /^只写这项已经结算的 NPC 反应/u.test(ceiling)
  );
}

function partOnePackage(projectRoot: string) {
  return loadPartOneRuntimePackage(
    "sangtian",
    path.join(projectRoot, "packages", "templates", "config"),
  ).package;
}
