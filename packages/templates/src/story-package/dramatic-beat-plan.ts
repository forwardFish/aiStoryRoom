export const DRAMATIC_BEAT_PLAN_SCHEMA = "dramatic-beat-plan-v1" as const;

export type DramaticBeatActor = {
  actorRef: string;
  displayName: string;
  goal?: string;
};

export type DramaticBeatStep = {
  stepId: string;
  kind:
    | "PATTERN_OPENING"
    | "PATTERN_MOVE"
    | "OBJECT_POWER_MOVE"
    | "COUNTERMOVE"
    | "REACTION_WINDOW"
    | "DECISION_PRESSURE";
  actorRefs: string[];
  actorLabels: string[];
  /**
   * Story-Package-authored meaning for this step. The Narrator may dramatize
   * it, but may not replace it with a different event or decision.
   */
  requiredMeaning: string;
  /** Actor goals are motivation, never facts that must be recited. */
  actorGoals: string[];
  expressionPolicy:
    | "ADAPT_PATTERN_TO_CURRENT_SCENE"
    | "DRAMATIZE_REQUIRED_MEANING"
    | "TRANSIENT_REACTION_ONLY"
    | "END_ON_UNRESOLVED_PRESSURE";
  /** All plan steps are expression-only. Settlement remains the fact owner. */
  durableMutationAllowed: false;
};

/**
 * A world-agnostic bridge between fact settlement and literary expression.
 * It decides the dramatic order without using keywords from any story world.
 */
export type DramaticBeatPlan = {
  schemaVersion: typeof DRAMATIC_BEAT_PLAN_SCHEMA;
  sceneRef: string;
  sceneObjective: string;
  activeActors: DramaticBeatActor[];
  steps: DramaticBeatStep[];
  texturePolicy: {
    ordinaryTextureMayVary: true;
    nonDurableDialogueMayVary: true;
    newDurableFactsForbidden: true;
  };
};

export type DramaticBeatPolicyInput = {
  actorRef: string;
  goal?: string;
};

export type DramaticBeatPlannerInput = {
  sceneRef: string;
  sceneObjective: string;
  presentActorRefs: string[];
  actorLabelsByRef: Record<string, string>;
  pressureActorRefs: string[];
  actorPolicies: DramaticBeatPolicyInput[];
  pressureMeaning: string;
  decisionStopMeaning: string;
};

export type DramaticPatternPlanInput = {
  openingPressure: string;
  orderedBeats: Array<{
    actorRole: string;
    observableMove: string;
    sceneFunction: string;
    reactionCue: string;
  }>;
  objectPowerMoves: Array<{
    objectLabel: string;
    observableUse: string;
    powerMeaning: string;
  }>;
};

export type DramaticBeatPlannerModule = {
  moduleId: string;
  plan(input: DramaticBeatPlannerInput): DramaticBeatPlan;
};

export const deterministicDramaticBeatPlanner: DramaticBeatPlannerModule = {
  moduleId: "deterministic-dramatic-beat-planner-v2",
  plan: compileDramaticBeatPlan,
};

export function compileDramaticBeatPlan(input: DramaticBeatPlannerInput): DramaticBeatPlan {
  const sceneRef = required(input.sceneRef, "DRAMATIC_BEAT_SCENE_MISSING");
  const sceneObjective = required(input.sceneObjective, "DRAMATIC_BEAT_OBJECTIVE_MISSING");
  const pressureMeaning = required(input.pressureMeaning, "DRAMATIC_BEAT_PRESSURE_MISSING");
  const decisionStopMeaning = required(input.decisionStopMeaning, "DRAMATIC_BEAT_STOP_MISSING");
  const presentActorRefs = unique(input.presentActorRefs.map(clean).filter(Boolean));
  if (!presentActorRefs.length) throw new Error("DRAMATIC_BEAT_CAST_MISSING");

  const policyGoalByActor = new Map(
    input.actorPolicies
      .map((policy) => [clean(policy.actorRef), clean(policy.goal || "")] as const)
      .filter(([actorRef]) => actorRef),
  );
  const activeActors = presentActorRefs.map((actorRef) => ({
    actorRef,
    displayName: clean(input.actorLabelsByRef[actorRef]) || actorRef,
    ...(policyGoalByActor.get(actorRef)
      ? { goal: policyGoalByActor.get(actorRef) }
      : {}),
  }));
  const pressureActorRefs = unique(
    input.pressureActorRefs.map(clean).filter((actorRef) => presentActorRefs.includes(actorRef)),
  );
  const primaryActorRefs = pressureActorRefs.length
    ? pressureActorRefs
    : presentActorRefs.slice(1, 2).length
      ? presentActorRefs.slice(1, 2)
      : presentActorRefs.slice(0, 1);
  const reactionActorRefs = presentActorRefs.filter((actorRef) => !primaryActorRefs.includes(actorRef));
  const labelsFor = (actorRefs: string[]) => actorRefs.map((actorRef) => (
    clean(input.actorLabelsByRef[actorRef]) || actorRef
  ));
  const goalsFor = (actorRefs: string[]) => unique(
    actorRefs.map((actorRef) => policyGoalByActor.get(actorRef) || "").filter(Boolean),
  );

  return {
    schemaVersion: DRAMATIC_BEAT_PLAN_SCHEMA,
    sceneRef,
    sceneObjective,
    activeActors,
    steps: [
      {
        stepId: "COUNTERMOVE",
        kind: "COUNTERMOVE",
        actorRefs: primaryActorRefs,
        actorLabels: labelsFor(primaryActorRefs),
        requiredMeaning: pressureMeaning,
        actorGoals: goalsFor(primaryActorRefs),
        expressionPolicy: "DRAMATIZE_REQUIRED_MEANING",
        durableMutationAllowed: false,
      },
      ...(reactionActorRefs.length
        ? [{
            stepId: "REACTION_WINDOW",
            kind: "REACTION_WINDOW" as const,
            actorRefs: reactionActorRefs,
            actorLabels: labelsFor(reactionActorRefs),
            requiredMeaning: "在场人物可作符合其目标与已知范围的短暂反应，但不得形成新的命令、证据、承诺或持久结果。",
            actorGoals: goalsFor(reactionActorRefs),
            expressionPolicy: "TRANSIENT_REACTION_ONLY" as const,
            durableMutationAllowed: false as const,
          }]
        : []),
      {
        stepId: "DECISION_PRESSURE",
        kind: "DECISION_PRESSURE",
        actorRefs: primaryActorRefs,
        actorLabels: labelsFor(primaryActorRefs),
        requiredMeaning: decisionStopMeaning,
        actorGoals: goalsFor(primaryActorRefs),
        expressionPolicy: "END_ON_UNRESOLVED_PRESSURE",
        durableMutationAllowed: false,
      },
    ],
    texturePolicy: {
      ordinaryTextureMayVary: true,
      nonDurableDialogueMayVary: true,
      newDurableFactsForbidden: true,
    },
  };
}

/**
 * Compile one approved NarrativeScenePattern into the already-authoritative
 * plan. The pattern supplies staging grammar only: it cannot introduce a new
 * fact, complete an action, move a document, reveal a secret or mutate state.
 * Actor roles are deterministically mapped onto actors already active in the
 * plan, so source-scene names and source-world props never become authority.
 */
export function applyNarrativeScenePatternToDramaticBeatPlan(
  plan: DramaticBeatPlan,
  pattern: DramaticPatternPlanInput | null | undefined,
): DramaticBeatPlan {
  if (!pattern) return plan;
  if (plan.steps.some((step) => step.kind === "PATTERN_OPENING" || step.kind === "PATTERN_MOVE")) {
    return plan;
  }

  const primaryActorRefs = unique(
    plan.steps
      .filter((step) => step.kind === "COUNTERMOVE")
      .flatMap((step) => step.actorRefs),
  );
  const activeActorRefs = plan.activeActors.map((actor) => actor.actorRef);
  const stagingActorRefs = unique([
    ...primaryActorRefs,
    ...activeActorRefs.filter((actorRef) => !primaryActorRefs.includes(actorRef)),
  ]);
  if (!stagingActorRefs.length) return plan;

  const actorByRef = new Map(plan.activeActors.map((actor) => [actor.actorRef, actor]));
  const labelsFor = (actorRefs: string[]) => actorRefs.map((actorRef) => (
    actorByRef.get(actorRef)?.displayName || actorRef
  ));
  const goalsFor = (actorRefs: string[]) => unique(
    actorRefs.map((actorRef) => actorByRef.get(actorRef)?.goal || "").filter(Boolean),
  );
  const assignedActor = (ordinal: number) => [
    stagingActorRefs[Math.max(0, ordinal - 1) % stagingActorRefs.length]!,
  ];
  const adapt = (meaning: string, boundary: string) => [
    "只把以下经批准的戏剧机制适配为当前场景中的短暂舞台动作；不得照搬来源场景的专名、物件、事实或结果：",
    required(meaning, "DRAMATIC_PATTERN_MEANING_MISSING"),
    `边界：${required(boundary, "DRAMATIC_PATTERN_BOUNDARY_MISSING")}`,
  ].join(" ");

  const patternSteps: DramaticBeatStep[] = [];
  const openingPressure = clean(pattern.openingPressure);
  if (openingPressure) {
    const actorRefs = assignedActor(1);
    patternSteps.push({
      stepId: "PATTERN_OPENING",
      kind: "PATTERN_OPENING",
      actorRefs,
      actorLabels: labelsFor(actorRefs),
      requiredMeaning: adapt(
        openingPressure,
        "它只能建立现场压力和人物姿态，不能新增命令、证据、文书、秘密、承诺、数量、位置变化或持久状态。",
      ),
      actorGoals: goalsFor(actorRefs),
      expressionPolicy: "ADAPT_PATTERN_TO_CURRENT_SCENE",
      durableMutationAllowed: false,
    });
  }

  pattern.orderedBeats.slice(0, 3).forEach((beat, index) => {
    const actorRefs = assignedActor(index + 1);
    patternSteps.push({
      stepId: `PATTERN_MOVE_${index + 1}`,
      kind: "PATTERN_MOVE",
      actorRefs,
      actorLabels: labelsFor(actorRefs),
      requiredMeaning: adapt(
        beat.observableMove,
        [
          `场景作用：${beat.sceneFunction}`,
          `反应边界：${beat.reactionCue}`,
          "actorRole 只是抽象戏剧职责，不能变成新人物或隐藏身份。",
        ].join("；"),
      ),
      actorGoals: goalsFor(actorRefs),
      expressionPolicy: "ADAPT_PATTERN_TO_CURRENT_SCENE",
      durableMutationAllowed: false,
    });
  });

  pattern.objectPowerMoves.slice(0, 1).forEach((move, index) => {
    const actorRefs = assignedActor(pattern.orderedBeats.length + index + 1);
    patternSteps.push({
      stepId: `OBJECT_POWER_MOVE_${index + 1}`,
      kind: "OBJECT_POWER_MOVE",
      actorRefs,
      actorLabels: labelsFor(actorRefs),
      requiredMeaning: adapt(
        `${move.objectLabel}：${move.observableUse}`,
        `这一动作只能表达“${move.powerMeaning}”的权力关系；若该物件不在当前 Scene Projection 中，必须改写成不新增关键物件的等价动作。`,
      ),
      actorGoals: goalsFor(actorRefs),
      expressionPolicy: "ADAPT_PATTERN_TO_CURRENT_SCENE",
      durableMutationAllowed: false,
    });
  });

  if (!patternSteps.length) return plan;
  const firstAuthoritativeIndex = plan.steps.findIndex((step) => step.kind === "COUNTERMOVE");
  const insertAt = firstAuthoritativeIndex < 0 ? 0 : firstAuthoritativeIndex;
  return {
    ...plan,
    steps: [
      ...plan.steps.slice(0, insertAt),
      ...patternSteps,
      ...plan.steps.slice(insertAt),
    ],
  };
}

function required(value: string, errorCode: string) {
  const normalized = clean(value);
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function clean(value: string) {
  return String(value || "").trim();
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
