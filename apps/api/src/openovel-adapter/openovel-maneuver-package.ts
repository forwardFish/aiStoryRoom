export type OpenNovelManeuverPackageType = "contact" | "investigate" | "leverage" | "custom";
export type OpenNovelLeverageResolutionMode = "FIXED" | "AI_REACTION";

export interface OpenNovelManeuverActorDefinition {
  roleKey: string;
  displayName: string;
  publicIdentity: string;
  portrait?: string;
  publicGoal: string;
  informationStyle: string;
}

export interface OpenNovelContactDefinition extends OpenNovelManeuverActorDefinition {
  relevance: string;
  statePatch: Record<string, number>;
  allowedFactKeys: string[];
  fallbackTitle: string;
  fallbackReply: string;
}

export interface OpenNovelInvestigationDefinition {
  intentKey: string;
  title: string;
  summary: string;
  resultTitle: string;
  resultText: string;
  factKeys: string[];
  statePatch: Record<string, number>;
  traces: string[];
}

export interface OpenNovelLeverageDefinition {
  leverageKey: string;
  label: string;
  description: string;
  resolutionMode: OpenNovelLeverageResolutionMode;
  requiresTarget: boolean;
  targetRoleKeys: string[];
  statePatch: Record<string, number>;
  factKeys: string[];
  resultTitle: string;
  fixedResultText?: string;
  fallbackReply?: string;
}

export interface OpenNovelManeuverSceneDefinition {
  sceneKey: string;
  contacts: OpenNovelContactDefinition[];
  investigations: OpenNovelInvestigationDefinition[];
  playableLeverageKeys: string[];
  customEnabled: boolean;
}

export interface OpenNovelManeuverCalendarEntry {
  sceneKey: string;
  usageDay: number;
}

export interface OpenNovelManeuverPackage {
  packageVersion: "openovel_maneuver_package_v1";
  worldId: string;
  calendar: {
    expectedTurns: number;
    scenes: readonly OpenNovelManeuverCalendarEntry[];
  };
  quota: {
    opportunitiesPerDay: number;
  };
  initialLeverageKeys: readonly string[];
  customPlan: {
    maxLength: number;
    title: string;
    statePatch: Readonly<Record<string, number>>;
    factKeys: readonly string[];
    traces: readonly string[];
    fallbackNarrative(customText: string): string;
  };
  scene(sceneKey: string): OpenNovelManeuverSceneDefinition | null;
  actor(roleKey: string): OpenNovelManeuverActorDefinition | null;
  leverage(leverageKey: string): OpenNovelLeverageDefinition | null;
  surfaces: {
    contactFallback(definition: OpenNovelContactDefinition): string;
    contactTrace(definition: OpenNovelContactDefinition): string;
    leverageFallback(input: {
      definition: OpenNovelLeverageDefinition;
      target: OpenNovelManeuverActorDefinition | null;
      response: string;
    }): string;
    leverageTrace(definition: OpenNovelLeverageDefinition): string;
    consumedLeverageLabel: string;
  };
}

export function defineOpenNovelManeuverPackage(
  value: OpenNovelManeuverPackage,
): OpenNovelManeuverPackage {
  validatePackage(value);
  return value;
}

export class OpenNovelManeuverPackageRegistry {
  private readonly packages = new Map<string, OpenNovelManeuverPackage>();

  constructor(packages: readonly OpenNovelManeuverPackage[] = []) {
    for (const pkg of packages) this.register(pkg);
  }

  register(pkg: OpenNovelManeuverPackage) {
    validatePackage(pkg);
    if (this.packages.has(pkg.worldId)) {
      throw new Error(`OPENOVEL_MANEUVER_PACKAGE_DUPLICATE:${pkg.worldId}`);
    }
    this.packages.set(pkg.worldId, pkg);
    return this;
  }

  get(worldId: string) {
    return this.packages.get(worldId) || null;
  }

  require(worldId: string) {
    const pkg = this.get(worldId);
    if (!pkg) throw new Error(`OPENOVEL_MANEUVER_PACKAGE_MISSING:${worldId}`);
    return pkg;
  }

  list() {
    return [...this.packages.values()];
  }
}

function validatePackage(pkg: OpenNovelManeuverPackage) {
  if (pkg.packageVersion !== "openovel_maneuver_package_v1") {
    throw new Error("OPENOVEL_MANEUVER_PACKAGE_VERSION_INVALID");
  }
  if (!pkg.worldId.trim()) throw new Error("OPENOVEL_MANEUVER_PACKAGE_WORLD_MISSING");
  if (!Number.isInteger(pkg.calendar.expectedTurns) || pkg.calendar.expectedTurns < 1) {
    throw new Error(`OPENOVEL_MANEUVER_PACKAGE_TURN_COUNT_INVALID:${pkg.worldId}`);
  }
  if (!pkg.calendar.scenes.length) {
    throw new Error(`OPENOVEL_MANEUVER_PACKAGE_CALENDAR_EMPTY:${pkg.worldId}`);
  }
  if (!Number.isInteger(pkg.quota.opportunitiesPerDay) || pkg.quota.opportunitiesPerDay < 1) {
    throw new Error(`OPENOVEL_MANEUVER_PACKAGE_QUOTA_INVALID:${pkg.worldId}`);
  }
  if (!Number.isInteger(pkg.customPlan.maxLength) || pkg.customPlan.maxLength < 1) {
    throw new Error(`OPENOVEL_MANEUVER_PACKAGE_CUSTOM_LIMIT_INVALID:${pkg.worldId}`);
  }

  const sceneKeys = new Set<string>();
  for (const entry of pkg.calendar.scenes) {
    if (!entry.sceneKey.trim() || sceneKeys.has(entry.sceneKey)) {
      throw new Error(`OPENOVEL_MANEUVER_PACKAGE_SCENE_INVALID:${pkg.worldId}:${entry.sceneKey}`);
    }
    if (!Number.isInteger(entry.usageDay) || entry.usageDay < 1) {
      throw new Error(`OPENOVEL_MANEUVER_PACKAGE_DAY_INVALID:${pkg.worldId}:${entry.sceneKey}`);
    }
    sceneKeys.add(entry.sceneKey);
    const scene = pkg.scene(entry.sceneKey);
    if (!scene || scene.sceneKey !== entry.sceneKey) {
      throw new Error(`OPENOVEL_MANEUVER_PACKAGE_SCENE_MISSING:${pkg.worldId}:${entry.sceneKey}`);
    }
    for (const contact of scene.contacts) {
      if (!pkg.actor(contact.roleKey)) {
        throw new Error(`OPENOVEL_MANEUVER_PACKAGE_ACTOR_MISSING:${pkg.worldId}:${contact.roleKey}`);
      }
    }
    for (const leverageKey of scene.playableLeverageKeys) {
      const leverage = pkg.leverage(leverageKey);
      if (!leverage) {
        throw new Error(`OPENOVEL_MANEUVER_PACKAGE_LEVERAGE_MISSING:${pkg.worldId}:${leverageKey}`);
      }
      for (const targetRoleKey of leverage.targetRoleKeys) {
        if (!pkg.actor(targetRoleKey)) {
          throw new Error(`OPENOVEL_MANEUVER_PACKAGE_TARGET_MISSING:${pkg.worldId}:${targetRoleKey}`);
        }
      }
    }
  }

  for (const leverageKey of pkg.initialLeverageKeys) {
    if (!pkg.leverage(leverageKey)) {
      throw new Error(`OPENOVEL_MANEUVER_PACKAGE_HAND_INVALID:${pkg.worldId}:${leverageKey}`);
    }
  }
}
