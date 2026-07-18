import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateSevenStages,
  loadContinuousStrategyPackageFromRoot,
  loadGameContinuousStrategyPackage,
  sha256Utf8,
  validateContinuousStrategyPackage,
  type ContinuousStrategyPackage
} from "../src";

const WORLD_ID = "caesar_fixture";
const VERSION = "caesar_fixture_v1";
const ROLES = ["caesar", "brutus", "cassius", "antony", "cicero", "octavian"];
const WORLD_ACTOR = "roman_public";
const HASH = "0".repeat(64);

function syntheticSixRolePackage(): ContinuousStrategyPackage {
  const stages: any[] = [];
  const roleStages: any[] = [];
  const systemActions: any[] = [];
  const policies: any[] = [];
  const fallbackActions: any[] = [];
  const maneuvers: any[] = [];
  const publicStageRules: any[] = [];
  const personalStageRules: any[] = [];

  for (let stageNumber = 1; stageNumber <= 7; stageNumber += 1) {
    const stageKey = `rome_s${stageNumber}`;
    const openState = `${stageKey}_open`;
    const nextState = `${stageKey}_resolved`;
    const contestAsset = `${stageKey}_forum`;
    const systemFact = `${stageKey}_public_pressure_fact`;
    const systemTrace = `${stageKey}_public_pressure_trace`;
    const systemAsset = `${stageKey}_public_pressure_asset`;
    const requestKey = `${stageKey}_request_0_1`;
    const facts: any[] = [{ factKey: systemFact, visibility: "PUBLIC" }];
    const traces: any[] = [{ traceKey: systemTrace, description: `Rome pressure trace ${stageNumber}` }];
    const assets: any[] = [
      { assetKey: contestAsset, kind: "CONTEST", initialOwnerRoleKey: null },
      { assetKey: systemAsset, kind: "WORLD", initialOwnerRoleKey: WORLD_ACTOR }
    ];

    for (const [roleIndex, roleKey] of ROLES.entries()) {
      const roleAsset = `${stageKey}_${roleKey}_asset`;
      assets.push({ assetKey: roleAsset, kind: "LEVERAGE", initialOwnerRoleKey: roleKey });
      const cards = [0, 1, 2].map((cardIndex) => {
        const actionKey = `${stageKey}_${roleKey}_main_${cardIndex}`;
        const factKey = `${actionKey}_fact`;
        const traceKey = `${actionKey}_trace`;
        facts.push({ factKey, visibility: "OBSERVABLE" });
        traces.push({ traceKey, description: `${roleKey} trace ${stageNumber}.${cardIndex}` });
        return {
          actionKey,
          title: `${roleKey} choice ${stageNumber}.${cardIndex}`,
          objective: `${roleKey} advances a distinct Roman objective ${stageNumber}.${cardIndex}`,
          visibility: "OBSERVABLE",
          risk: "NORMAL",
          fallbackActionKey: `${stageKey}_${roleKey}_fallback`,
          targetRoleKey: ROLES[(roleIndex + 1) % ROLES.length],
          receipt: { receiptKey: `${actionKey}_receipt`, text: `${roleKey} receipt ${stageNumber}.${cardIndex}` },
          effect: {
            effectKey: `${actionKey}_effect`,
            factKeys: [factKey],
            influenceEdges: [{ affectedRoleKey: ROLES[(roleIndex + 1) % ROLES.length], effectKey: `${actionKey}_influence`, visibility: "OBSERVABLE" }],
            observableTraceKeys: [traceKey],
            interactionRequestKeys: roleIndex === 0 && cardIndex === 0 ? [requestKey] : [],
            nextStateKey: nextState
          },
          assetMutations: [{ assetKey: roleAsset, mutationType: "SPEND", delta: -1, toRoleKey: roleKey }]
        };
      });
      roleStages.push({ stageKey, roleKey, privateBrief: `${roleKey} private brief ${stageNumber}`, personalPressure: `${roleKey} pressure ${stageNumber}`, mainCards: cards });
      fallbackActions.push({ actionKey: `${stageKey}_${roleKey}_fallback`, stageKey, roleKey, actionSlot: "MAIN", objective: `${roleKey} preserves position ${stageNumber}`, factKeys: [cards[0].effect.factKeys[0]], nextStateKey: nextState, assetMutations: [{ assetKey: roleAsset, mutationType: "HOLD", delta: 0, toRoleKey: roleKey }] });
      policies.push({ stageKey, roleKey, policyVersion: `${VERSION}:${stageKey}:${roleKey}`, goals: [{ goalKey: `${roleKey}_goal`, weight: 100 }], riskProfile: "BALANCED", assetPriority: [roleAsset], actionWeights: cards.map((card, index) => ({ actionKey: card.actionKey, weight: 50 - index })), fallbackBySlot: { MAIN: `${stageKey}_${roleKey}_fallback`, MANEUVER: "PASS" } });
      maneuvers.push({ maneuverStrategyKey: `${stageKey}_${roleKey}_maneuver`, stageKey, roleKey, title: `${roleKey} maneuver ${stageNumber}`, objective: `${roleKey} maneuver objective ${stageNumber}`, allowedTargetRoleKeys: [ROLES[(roleIndex + 1) % ROLES.length]], leverageAssetKeys: [roleAsset], allowedTypes: ["LEVERAGE"], fallbackActionKey: `${stageKey}_${roleKey}_fallback` });
      personalStageRules.push({ ruleKey: `${stageKey}_${roleKey}_result`, stageKey, roleKey, candidateFactKeys: cards.map((card) => card.effect.factKeys[0]), summary: `${roleKey} personal result ${stageNumber}` });
    }

    const allRoleFacts = roleStages.filter((entry) => entry.stageKey === stageKey).flatMap((entry) => entry.mainCards.map((card: any) => card.effect.factKeys[0]));
    stages.push({
      stageKey,
      stageNumber,
      title: `Roman stage ${stageNumber}`,
      playableRoleKeys: [...ROLES],
      systemRoleKey: WORLD_ACTOR,
      commonContest: { contestKey: `${stageKey}_contest`, title: `Roman contest ${stageNumber}`, assetKey: contestAsset, description: `A distinct Roman contest for stage ${stageNumber}` },
      stateCatalog: [{ stateKey: openState, description: "Open" }, { stateKey: nextState, description: "Resolved" }],
      factCatalog: facts,
      assetCatalog: assets,
      traceCatalog: traces,
      interactionRequestCatalog: [{ requestKey, sourceRoleKey: ROLES[0], targetRoleKey: ROLES[1], eventType: "ROMAN_REPLY", defaultOutcomeKey: `${stageKey}_default_reply` }],
      carriedFactKeys: [],
      systemActionKey: `${stageKey}_world_action`,
      nextStateKey: nextState,
      minimumDistinctPlayableInfluenceSources: 2
    });
    systemActions.push({ systemActionKey: `${stageKey}_world_action`, stageKey, roleKey: WORLD_ACTOR, inputStateKeys: [openState], factKeys: [systemFact], observableTraceKeys: [systemTrace], visiblePressure: `Roman public pressure ${stageNumber}`, claimable: false, controllerMode: "SYSTEM", assetMutations: [{ assetKey: systemAsset, mutationType: "PRESSURE", delta: 1, toRoleKey: null }], nextStateKey: nextState });
    publicStageRules.push({ ruleKey: `${stageKey}_public_result`, stageKey, candidateFactKeys: allRoleFacts, outcomeStateKey: nextState, summary: `Roman public result ${stageNumber}` });
  }

  const content = {
    contract: { worldId: WORLD_ID, strategyVersion: VERSION, playableRoleKeys: [...ROLES], worldActorKey: WORLD_ACTOR },
    registry: { schemaVersion: "strategy_registry_v1", defaultStrategyVersion: VERSION, strategies: { [VERSION]: { artifactDirectory: "continuous-strategy-v1", manifestSha256: HASH, status: "published" } } },
    manifest: { schemaVersion: "continuous_strategy_manifest_v1", contentVersion: VERSION, templateKey: WORLD_ID, releaseStatus: "published", stageCoverage: [1, 2, 3, 4, 5, 6, 7], files: [{ path: "stages.json", sha256: HASH }] },
    stages: { schemaVersion: "continuous_strategy_stages_v1", contentVersion: VERSION, stages },
    roleStageContent: { schemaVersion: "continuous_strategy_role_stage_content_v1", contentVersion: VERSION, roleStages },
    systemActions: { schemaVersion: "continuous_strategy_system_actions_v1", contentVersion: VERSION, systemActions },
    agentPolicies: { schemaVersion: "continuous_strategy_agent_policies_v1", contentVersion: VERSION, policies, fallbackActions },
    maneuverStrategies: { schemaVersion: "continuous_strategy_maneuvers_v1", contentVersion: VERSION, maneuverStrategies: maneuvers },
    reactionScenarios: { schemaVersion: "continuous_strategy_reactions_v1", contentVersion: VERSION, reactionScenarios: [] },
    resultRules: { schemaVersion: "continuous_strategy_result_rules_v1", contentVersion: VERSION, publicStageRules, personalStageRules },
    endingRules: { schemaVersion: "continuous_strategy_ending_rules_v1", contentVersion: VERSION, globalEndingRule: { ruleKey: "rome_global_ending", metric: "evidence", evidenceStageRange: [1, 6], classifications: [{ endingKey: "rome_continues", title: "Rome Continues", minimumScore: 0 }] }, personalEndingRules: ROLES.map((roleKey) => ({ ruleKey: `${roleKey}_ending`, roleKey, metric: "agency", evidenceStageRange: [1, 6], classifications: [{ endingKey: `${roleKey}_survives`, title: `${roleKey} Survives`, minimumScore: 0 }] })) },
    artifactHashes: {}
  } as unknown as ContinuousStrategyPackage;
  return validateContinuousStrategyPackage(content);
}

function writeLoadablePackage(root: string, content: ContinuousStrategyPackage) {
  const artifactRoot = join(root, "continuous-strategy-v1");
  mkdirSync(join(artifactRoot, "schemas"), { recursive: true });
  const artifacts: Record<string, unknown> = {
    "stages.json": content.stages,
    "role-stage-content.json": content.roleStageContent,
    "system-actions.json": content.systemActions,
    "agent-policies.json": content.agentPolicies,
    "maneuver-strategies.json": content.maneuverStrategies,
    "reaction-scenarios.json": content.reactionScenarios,
    "result-rules.json": content.resultRules,
    "ending-rules.json": content.endingRules
  };
  for (const name of ["manifest", "stages", "role-stage-content", "maneuver-strategies", "reaction-scenarios", "system-actions", "agent-policies", "result-rules", "ending-rules", "strategy-registry"]) {
    artifacts[`schemas/${name}.schema.json`] = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false };
  }
  const files = Object.entries(artifacts).map(([path, value]) => {
    const bytes = JSON.stringify(value);
    writeFileSync(join(artifactRoot, path), bytes, "utf8");
    return { path, sha256: sha256Utf8(bytes) };
  });
  const manifest = { ...content.manifest, files };
  const manifestBytes = JSON.stringify(manifest);
  writeFileSync(join(artifactRoot, "manifest.json"), manifestBytes, "utf8");
  const registry = { schemaVersion: "strategy_registry_v1", defaultStrategyVersion: VERSION, strategies: { [VERSION]: { artifactDirectory: "continuous-strategy-v1", manifestSha256: sha256Utf8(manifestBytes), status: "published" } } };
  writeFileSync(join(root, "strategy-registry.json"), JSON.stringify(registry), "utf8");
}

test("continuous strategy validation and evaluation support six normal roles", () => {
  const content = syntheticSixRolePackage();
  assert.equal(content.contract.playableRoleKeys.length, 6);
  assert.equal(content.roleStageContent.roleStages.length, 42);
  assert.equal(content.roleStageContent.roleStages.flatMap((entry) => entry.mainCards).length, 126);
  const first = evaluateSevenStages(content);
  const second = evaluateSevenStages(content);
  assert.deepEqual(first, second);
  assert.equal(first.personalResults.length, 42);
  assert.equal(first.ending.personal.length, 6);
});

test("the content graph rejects a game contract whose role list does not match the stages", () => {
  const content = syntheticSixRolePackage();
  const changed = structuredClone(content);
  changed.contract.playableRoleKeys = changed.contract.playableRoleKeys.slice(0, 5);
  assert.throws(() => validateContinuousStrategyPackage(changed), /player roles differ from the game contract/);
});

test("the same filesystem loader reads a second world by explicit world and strategy contract", () => {
  const root = mkdtempSync(join(tmpdir(), "many-worlds-caesar-fixture-"));
  try {
    const content = syntheticSixRolePackage();
    writeLoadablePackage(root, content);
    const loaded = loadContinuousStrategyPackageFromRoot(content.contract, root);
    assert.equal(loaded.contract.worldId, WORLD_ID);
    assert.equal(loaded.manifest.templateKey, WORLD_ID);
    assert.deepEqual(loaded.contract.playableRoleKeys, ROLES);
    assert.equal(evaluateSevenStages(loaded).ending.personal.length, 6);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a game definition may place its strategy registry at a non-default relative path", () => {
  const configRoot = mkdtempSync(join(tmpdir(), "nested-game-registry-fixture-"));
  try {
    const worldRoot = join(configRoot, WORLD_ID);
    const strategyRoot = join(worldRoot, "strategies");
    mkdirSync(strategyRoot, { recursive: true });
    writeLoadablePackage(strategyRoot, syntheticSixRolePackage());
    renameSync(join(strategyRoot, "strategy-registry.json"), join(strategyRoot, "index.json"));
    const roleDefinition = (roleKey: string) => ({
      roleKey,
      roleName: roleKey,
      identity: `${roleKey} identity`,
      publicInfo: `${roleKey} public information`,
      hiddenSecret: `${roleKey} hidden secret`,
      personalGoal: `${roleKey} personal goal`,
      currentState: `${roleKey} current state`,
      abilityText: `${roleKey} ability`,
      arcText: `${roleKey} arc`,
      knownInfo: [],
      cannotDo: [],
      portrait: `/assets/roles/${roleKey}.webp`,
      canBeHumanControlled: true,
      canBeAiControlled: true
    });
    writeFileSync(join(configRoot, "game-registry.json"), JSON.stringify({
      schemaVersion: "game_registry_v1",
      games: [{ worldId: WORLD_ID, definitionPath: `${WORLD_ID}/game.json` }]
    }));
    writeFileSync(join(worldRoot, "game.json"), JSON.stringify({
      schemaVersion: "game_definition_v1",
      worldId: WORLD_ID,
      publicId: WORLD_ID,
      aliases: [],
      templateId: "midnight-store-v1",
      status: "playable",
      catalog: { title: "Rome", subtitle: "Fixture", description: "Six-role fixture", genre: "strategy", tags: ["fixture"], durationLabel: "7 rounds", cardCover: "/assets/worlds/rome.webp", heroCover: "/assets/worlds/rome.webp" },
      modes: { solo: true, multiplayer: true, minHumanPlayers: 1, maxHumanPlayers: 6 },
      engine: { engineVersion: "continuous_strategy_v1_1", strategyVersion: VERSION, strategyRegistryPath: "strategies/index.json", fixedRules: { stageCount: 7, mainCardsPerRoleStage: 3 } },
      worldActor: { actorKey: WORLD_ACTOR, actorName: "Roman Public", description: "World pressure", portrait: "/assets/roles/roman-public.webp" },
      presentation: { locationLabel: "Rome", roundLabel: "Round", finaleLabel: "Finale", sceneBackground: "/assets/worlds/rome.webp", assetManifest: null, accent: "#a00", accentSoft: "#fdd" },
      roles: ROLES.map(roleDefinition)
    }));
    const loaded = loadGameContinuousStrategyPackage(WORLD_ID, VERSION, configRoot);
    assert.deepEqual(loaded.contract.playableRoleKeys, ROLES);
    assert.equal(loaded.registry.defaultStrategyVersion, VERSION);
  } finally {
    rmSync(configRoot, { recursive: true, force: true });
  }
});
