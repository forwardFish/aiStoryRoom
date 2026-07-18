import { Injectable } from "@nestjs/common";
import {
  loadGameContinuousStrategyPackage,
  type AgentPolicy,
  type ContinuousStrategyPackage,
  type FallbackAction,
  type ManeuverStrategy,
  type ReactionScenario,
  type RoleStageContent,
  type StageDefinition
} from "@ai-story/templates";

@Injectable()
export class ContinuousStrategyContentService {
  private readonly cached = new Map<string, ContinuousStrategyPackage>();

  package(worldId: string, strategyVersion: string): ContinuousStrategyPackage {
    const cacheKey = `${worldId}\u0000${strategyVersion}`;
    let content = this.cached.get(cacheKey);
    if (!content) {
      content = loadGameContinuousStrategyPackage(worldId, strategyVersion);
      this.cached.set(cacheKey, content);
    }
    if (content.manifest.releaseStatus !== "published") {
      throw new Error("CONTINUOUS_STRATEGY_CONTENT_NOT_PUBLISHED");
    }
    return content;
  }

  forGame(worldId: string, strategyVersion: string) {
    const content = this.package(worldId, strategyVersion);
    return {
      package: () => content,
      stage: (stageIndex: number) => this.stageFrom(content, stageIndex),
      roleStage: (stageIndex: number, roleKey: string) => this.roleStageFrom(content, stageIndex, roleKey),
      maneuver: (stageIndex: number, roleKey: string, actionKey?: string) => this.maneuverFrom(content, stageIndex, roleKey, actionKey),
      reaction: (stageIndex: number, targetRoleKey: string, actionKey?: string) => this.reactionFrom(content, stageIndex, targetRoleKey, actionKey),
      agentPolicy: (stageIndex: number, roleKey: string) => this.agentPolicyFrom(content, stageIndex, roleKey),
      fallbackAction: (stageIndex: number, roleKey: string, actionKey?: string) => this.fallbackActionFrom(content, stageIndex, roleKey, actionKey),
      isPlayableRoleKey: (roleKey: string) => content.contract.playableRoleKeys.includes(roleKey)
    };
  }

  private stageFrom(content: ContinuousStrategyPackage, stageIndex: number): StageDefinition {
    const stage = content.stages.stages.find((entry) => entry.stageNumber === stageIndex);
    if (!stage) throw new Error(`CONTINUOUS_STRATEGY_STAGE_NOT_FOUND:${stageIndex}`);
    return stage;
  }

  private roleStageFrom(content: ContinuousStrategyPackage, stageIndex: number, roleKey: string): RoleStageContent {
    const stage = this.stageFrom(content, stageIndex);
    const entry = content.roleStageContent.roleStages.find(
      (candidate) => candidate.stageKey === stage.stageKey && candidate.roleKey === roleKey
    );
    if (!entry) throw new Error(`CONTINUOUS_STRATEGY_ROLE_STAGE_NOT_FOUND:${stageIndex}:${roleKey}`);
    return entry;
  }

  private maneuverFrom(content: ContinuousStrategyPackage, stageIndex: number, roleKey: string, actionKey?: string): ManeuverStrategy | undefined {
    const stage = this.stageFrom(content, stageIndex);
    const candidates = content.maneuverStrategies.maneuverStrategies.filter(
      (candidate) => candidate.stageKey === stage.stageKey && candidate.roleKey === roleKey
    );
    return actionKey ? candidates.find((candidate) => candidate.maneuverStrategyKey === actionKey) : candidates[0];
  }

  private reactionFrom(content: ContinuousStrategyPackage, stageIndex: number, targetRoleKey: string, actionKey?: string): ReactionScenario | undefined {
    const stage = this.stageFrom(content, stageIndex);
    return content.reactionScenarios.reactionScenarios.find((candidate) =>
      candidate.stageKey === stage.stageKey
      && candidate.targetRoleKey === targetRoleKey
      && (!actionKey || candidate.responseOptions.some((option) => option.actionKey === actionKey))
    );
  }

  private agentPolicyFrom(content: ContinuousStrategyPackage, stageIndex: number, roleKey: string): AgentPolicy {
    const stage = this.stageFrom(content, stageIndex);
    const policy = content.agentPolicies.policies.find(
      (candidate) => candidate.stageKey === stage.stageKey && candidate.roleKey === roleKey
    );
    if (!policy) throw new Error(`CONTINUOUS_STRATEGY_AGENT_POLICY_NOT_FOUND:${stageIndex}:${roleKey}`);
    return policy;
  }

  private fallbackActionFrom(content: ContinuousStrategyPackage, stageIndex: number, roleKey: string, actionKey?: string): FallbackAction {
    const stage = this.stageFrom(content, stageIndex);
    const fallback = content.agentPolicies.fallbackActions.find(
      (candidate) => candidate.stageKey === stage.stageKey
        && candidate.roleKey === roleKey
        && (!actionKey || candidate.actionKey === actionKey)
    );
    if (!fallback) throw new Error(`CONTINUOUS_STRATEGY_FALLBACK_NOT_FOUND:${stageIndex}:${roleKey}:${actionKey || "default"}`);
    return fallback;
  }
}

export type BoundContinuousStrategyContent = ReturnType<ContinuousStrategyContentService["forGame"]>;
