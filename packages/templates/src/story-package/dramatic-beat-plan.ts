export const DRAMATIC_BEAT_PLAN_SCHEMA = "dramatic-beat-plan-v1" as const;

export type DramaticBeatActor = {
  actorRef: string;
  displayName: string;
  goal?: string;
};

export type DramaticBeatStep = {
  stepId: string;
  kind: "COUNTERMOVE" | "REACTION_WINDOW" | "DECISION_PRESSURE";
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
    | "DRAMATIZE_REQUIRED_MEANING"
    | "TRANSIENT_REACTION_ONLY"
    | "END_ON_UNRESOLVED_PRESSURE";
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

export type DramaticBeatPlannerModule = {
  moduleId: string;
  plan(input: DramaticBeatPlannerInput): DramaticBeatPlan;
};

export const deterministicDramaticBeatPlanner: DramaticBeatPlannerModule = {
  moduleId: "deterministic-dramatic-beat-planner-v1",
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
