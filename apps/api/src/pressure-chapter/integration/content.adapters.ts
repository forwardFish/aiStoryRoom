import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  validateWorldStateV1,
  type ChapterIdV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  PressureChapterRouteRegistry,
  assertPressureChapterDefinition,
  compileInitialWorldState,
  contentPolicyHashForChapterV1,
  createChapterWorkingState,
  createPublishedSangtianPressureChapterRegistryV1,
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureStorySourceV1,
  loadSangtianPressureChapterPackageV1,
  selectAvailableSangtianDecisionPointsV1,
  type ChapterWorkingState,
  type PressureChapterDefinition,
  type PublishSangtianPressureChapterRouteInputV1,
  type PublishedSangtianActionReleaseV1,
} from "@ai-story/templates";
import type { GenesisContentPort } from "../genesis/types";
import type {
  ActiveDecisionStateV1,
  AuthoredChapterContentPort,
  AuthoredChapterRuntimeV1,
  ChapterAuthorityBaseV1,
  ChapterWorkingSeedPort,
} from "../orchestrator/contracts";
import { validateAuthoredChapterRuntimeV1 } from "../orchestrator/validation";
import {
  assertInitialRoleControlTopology,
  type InitialRoleControlTopologyV1,
  type PressureChapterRouteRegistryPort,
} from "../run-router";
import type {
  PressureGameDecisionProjectionV1,
  PressureGameMetricProjectionV1,
  PressureGameWorkbenchV1,
} from "../game-projection/contracts";
import { failPressureChapterIntegration } from "./errors";

export type PublishedSangtianRouteConfigurationV1 = Omit<
  PublishSangtianPressureChapterRouteInputV1,
  "package"
>;

/**
 * Publishes the one accepted Sangtian route into the concrete templates
 * registry. The caller supplies deployment/version pins; content is always
 * loaded from the accepted immutable package, never from a request payload.
 */
export function createPublishedSangtianRouteRegistryPortV1(
  configuration: PublishedSangtianRouteConfigurationV1,
): PressureChapterRouteRegistryPort {
  return new PressureChapterRouteRegistry(
    createPublishedSangtianPressureChapterRegistryV1(configuration),
  );
}

/** P0 content adapter. It creates no ChapterRuntime and performs no settlement. */
export class SangtianGenesisContentAdapterV1 implements GenesisContentPort {
  private readonly loaded = loadSangtianPressureChapterPackageV1();

  async loadP0(input: {
    route: RunRouteSnapshotV1;
    controlTopology: InitialRoleControlTopologyV1;
  }): Promise<WorldStateV1> {
    const route = assertAcceptedContentRoute(input.route, this.loaded.manifest);
    const topology = assertInitialRoleControlTopology(
      input.controlTopology,
      route.participantMode,
    );
    if (
      topology.controlTopologyVersion !== route.controlTopologyVersion
      || topology.topologyHash !== route.initialRoleControlSnapshotHash
    ) {
      failPressureChapterIntegration(
        "INTEGRATION_ROUTE_MISMATCH",
        "genesis.controlTopology",
        "FROZEN_ROUTE_BINDING_MISMATCH",
      );
    }
    return structuredClone(compileInitialWorldState(this.loaded));
  }
}

/**
 * DB/read-model seam required by WorkingSeed. Implementations must return the
 * exact Genesis/Frozen world bound by ChapterAuthorityBaseV1; they must not
 * derive it from WorkingLedger or Narrative data.
 */
export interface AuthoritativeChapterWorldReaderPort {
  readAuthorityBase(input: Readonly<{
    runId: string;
    routeHash: string;
    baseWorldSequence: number;
    baseWorldStateHash: string;
    previousFrozenHash: string;
  }>): Promise<Readonly<{
    routeHash: string;
    sourceFrozenHash: string;
    worldState: WorldStateV1;
  }> | null>;
}

/**
 * Converts the accepted execution definitions into W4's dynamic-kernel
 * descriptor. Options own WorkingDelta only: they close one decision point and
 * never touch worldSequence/Frozen/Finale state.
 */
export class SangtianAuthoredChapterContentAdapterV1
implements AuthoredChapterContentPort {
  private readonly loaded = loadSangtianPressureChapterPackageV1();

  async load(input: {
    routeSnapshot: RunRouteSnapshotV1;
    chapterId: ChapterIdV1;
  }): Promise<AuthoredChapterRuntimeV1> {
    const route = assertAcceptedContentRoute(
      input.routeSnapshot,
      this.loaded.manifest,
    );
    const compiled = this.loaded.chapters.find(
      (chapter) => chapter.chapterId === input.chapterId,
    );
    const authored = this.loaded.content.chapters.find(
      (chapter) => chapter.chapterId === input.chapterId,
    );
    if (!compiled || !authored) {
      failPressureChapterIntegration(
        "INTEGRATION_CONTENT_MISMATCH",
        "chapterId",
        input.chapterId,
      );
    }

    const points: PressureChapterDefinition["decisionPoints"] =
      compiled.decisionPoints.map((point, index) => {
        return {
          decisionPointId: point.definition.decisionPointKey,
          kernelId: point.definition.beatResolutionPolicy,
          chapterId: input.chapterId,
          sourceOrder: point.definition.ordinal,
          prompt: point.definition.purpose,
          requirementIds: [],
          priority: {
            duePressureCount: compiled.decisionPoints.length - index,
          },
          options: point.definition.allowedActionTypes.map(
            (actionType, optionIndex) => ({
              // Internal domain id only. User-facing copy comes from the
              // separately frozen presentation catalog below.
              optionId: optionIdForActionTypeV1(actionType),
              sourceOrder: optionIndex + 1,
              label: `internal:${actionType}`,
              workingDelta: {
                setFacts: {
                  [closeFactRef(point.definition)]: true,
                },
              },
            }),
          ),
        };
      });
    const definition = assertPressureChapterDefinition({
      schemaVersion: "pressure_chapter_definition_v1",
      chapterId: input.chapterId,
      sequence: chapterNumber(input.chapterId),
      decisionPoints: points,
      requirementDependencies: [],
    });
    const decisions: AuthoredChapterRuntimeV1["decisions"] =
      compiled.decisionPoints.map((point) => {
        const execution = structuredClone(point.definition);
        const required = new Set(execution.requiredSeatIds);
        return {
          decisionPointId: execution.decisionPointKey,
          execution,
          seatRequirements: Object.fromEntries(
            PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
              seatId,
              required.has(seatId) ? "REQUIRED" : "NOT_REQUIRED",
            ]),
          ) as AuthoredChapterRuntimeV1["decisions"][number]["seatRequirements"],
        };
      });
    const body = {
      schemaVersion: "pressure_authored_chapter_runtime_v1" as const,
      chapterId: input.chapterId,
      definition,
      decisions,
      chapterClosePolicy: {
        kind: "ALL_AUTHORED_DECISION_POINTS_COMPLETED" as const,
        decisionPointIds: points.map((point) => point.decisionPointId),
      },
      contentPolicyVersion: authored.settlementPolicy.policyVersion,
      contentPolicyHash: contentPolicyHashForChapterV1(
        input.chapterId,
        this.loaded,
      ),
      settlementContractVersion: route.runtimeContractVersion,
      settlementContractHash: route.runtimeContractSha256,
    };
    return validateAuthoredChapterRuntimeV1({
      ...body,
      descriptorHash: sha256Canonical(body),
    });
  }
}

/**
 * Opens a revision-zero WorkingState from the exact authoritative world. For
 * content-driven dynamic chapters, unavailable points are explicitly marked
 * skipped/completed in that immutable seed; Runtime never assumes a fixed
 * number of points.
 */
export class SangtianChapterWorkingSeedAdapterV1
implements ChapterWorkingSeedPort {
  private readonly loaded = loadSangtianPressureChapterPackageV1();
  private readonly actionRelease = loadPublishedSangtianActionReleaseV1();

  constructor(private readonly worlds: AuthoritativeChapterWorldReaderPort) {}

  async load(input: {
    routeSnapshot: RunRouteSnapshotV1;
    chapter: AuthoredChapterRuntimeV1;
    authorityBase: ChapterAuthorityBaseV1;
  }): Promise<ChapterWorkingState> {
    const route = assertAcceptedContentRoute(
      input.routeSnapshot,
      this.loaded.manifest,
    );
    if (input.authorityBase.baseWorldSequence !== chapterNumber(input.chapter.chapterId) - 1) {
      failPressureChapterIntegration(
        "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
        "workingSeed.baseWorldSequence",
      );
    }
    const source = await this.worlds.readAuthorityBase({
      runId: route.runId,
      routeHash: route.routeHash,
      ...input.authorityBase,
    });
    if (!source) {
      failPressureChapterIntegration(
        "INTEGRATION_AUTHORITY_SOURCE_MISSING",
        "workingSeed.authorityBase",
      );
    }
    const world = validateWorldStateV1(source.worldState);
    if (
      source.routeHash !== route.routeHash
      || source.sourceFrozenHash !== input.authorityBase.previousFrozenHash
      || world.worldSequence !== input.authorityBase.baseWorldSequence
      || world.stateHash !== input.authorityBase.baseWorldStateHash
    ) {
      failPressureChapterIntegration(
        "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
        "workingSeed.authorityBase",
      );
    }
    const compiled = this.loaded.chapters.find(
      (chapter) => chapter.chapterId === input.chapter.chapterId,
    );
    if (!compiled) {
      failPressureChapterIntegration(
        "INTEGRATION_CONTENT_MISMATCH",
        "workingSeed.chapterId",
      );
    }
    const available = new Set(
      selectAvailableSangtianDecisionPointsV1(
        compiled,
        world.factValues,
      ).map((point) => point.definition.decisionPointKey),
    );
    const inactivePointIds = input.chapter.definition.decisionPoints
      .map((point) => point.decisionPointId)
      .filter((decisionPointId) => !available.has(decisionPointId))
      .sort(compareCanonicalText);
    const workingFactIdentities = this.actionRelease.compileChapterActionEffects({
      chapterId: input.chapter.chapterId,
      confirmedActions: [],
      defaultEvents: [],
    }).settlementFacts;
    const seed = createChapterWorkingState({
      runId: route.runId,
      chapterId: input.chapter.chapterId,
      facts: {
        ...structuredClone(workingFactIdentities),
        ...structuredClone(world.factValues),
      },
      counters: {
        ...Object.fromEntries(
          Object.entries(world.resources).map(([key, value]) => [
            `resource.${key}`,
            value,
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(world.tracks.values).map(([key, value]) => [
            `track.${key}`,
            value,
          ]),
        ),
      },
    });
    seed.completedDecisionPointIds = inactivePointIds;
    return structuredClone(seed);
  }
}

/**
 * Pure content mapper for the viewer-scoped game reader. It deliberately does
 * not implement PressureGameChapterReaderPort because that current port lacks
 * viewerSeatId while `decision.requirement` is viewer-specific.
 */
export class SangtianPressureGameContentMapperV1 {
  private readonly loaded = loadSangtianPressureChapterPackageV1();

  constructor(
    private readonly presentations: SangtianActionPresentationCatalogPortV1,
  ) {}

  chapterTitle(chapterId: "P0" | ChapterIdV1): string {
    if (chapterId === "P0") return this.loaded.content.genesis.title;
    const chapter = this.loaded.content.chapters.find(
      (candidate) => candidate.chapterId === chapterId,
    );
    if (!chapter) {
      failPressureChapterIntegration(
        "INTEGRATION_CONTENT_MISMATCH",
        "game.chapterId",
        chapterId,
      );
    }
    return chapter.title;
  }

  metrics(worldValue: WorldStateV1): PressureGameMetricProjectionV1[] {
    const world = validateWorldStateV1(worldValue);
    return this.loaded.content.genesis.tracks.map((track) => ({
      trackId: track.trackId,
      label: track.name,
      value: world.tracks.values[track.trackId],
      displayValue: String(world.tracks.values[track.trackId]),
      tone: "DEFAULT" as const,
    }));
  }

  decisionForSeat(input: Readonly<{
    chapter: AuthoredChapterRuntimeV1;
    activeDecision: ActiveDecisionStateV1 | null;
    viewerSeatId: SeatIdV1;
    workingRevision: number;
  }>): PressureGameDecisionProjectionV1 | null {
    if (!input.activeDecision) return null;
    const runtime = input.chapter.decisions.find(
      (candidate) => candidate.decisionPointId === input.activeDecision!.decisionPointId,
    );
    const point = input.chapter.definition.decisionPoints.find(
      (candidate) => candidate.decisionPointId === input.activeDecision!.decisionPointId,
    );
    const seat = input.activeDecision.seats.find(
      (candidate) => candidate.seatId === input.viewerSeatId,
    );
    if (!runtime || !point || !seat) {
      failPressureChapterIntegration(
        "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
        "game.activeDecision",
      );
    }
    const options = runtime.execution.allowedActionTypes
      .filter((actionType) => actionType !== "DEFAULT_PASS")
      .map((actionType) => {
      const optionId = optionIdForActionTypeV1(actionType);
      const authoredOption = point.options.find(
        (candidate) => candidate.optionId === optionId,
      );
      if (!authoredOption) {
        failPressureChapterIntegration(
          "INTEGRATION_CONTENT_MISMATCH",
          "game.decision.options",
          actionType,
        );
      }
      const presentation = this.presentations.read({
        contentPackageVersion: this.loaded.manifest.packageVersion,
        contentPackageHash: this.loaded.manifest.contentSha256,
        chapterId: input.chapter.chapterId,
        decisionPointId: runtime.decisionPointId,
        actionType,
      });
      if (
        presentation.actionType !== actionType
        || !isPublishedWorkbenchEntryV1(presentation.preferredEntry)
        || !presentation.label.trim()
        || !presentation.description.trim()
      ) {
        failPressureChapterIntegration(
          "INTEGRATION_CONTENT_MISMATCH",
          "game.actionPresentation",
          actionType,
        );
      }
      return {
        code: optionId,
        label: presentation.label,
        description: presentation.description,
        actionType,
        preferredEntry: presentation.preferredEntry,
      };
    });
    const decisionScene = input.chapter.chapterId === "N1"
      && runtime.decisionPointId === "N1.weir_crisis"
      ? loadSangtianPressureStorySourceV1(input.chapter.chapterId, input.viewerSeatId).currentScene
      : null;
    return {
      decisionPointId: runtime.decisionPointId,
      mode: runtime.execution.mode,
      requirement: seat.requirement,
      title: decisionScene ? `${decisionScene.title}：你先下哪一道命令？` : runtime.execution.purpose,
      summary: decisionScene?.text ?? runtime.execution.purpose,
      expectedWorkingRevision: input.workingRevision,
      options,
      submitLabel: "确认正式行动",
      // Free text is preserved as the player's real action. The command
      // compiler may bind it to a matching formal action or DEFAULT_PASS; it
      // never lets free text invent a WorkingDelta.
      customActionAllowed: runtime.execution.allowedActionTypes.includes("DEFAULT_PASS"),
    };
  }
}

export function optionIdForActionTypeV1(actionType: string): string {
  if (!actionType.trim()) {
    failPressureChapterIntegration(
      "INTEGRATION_INPUT_INVALID",
      "actionType",
    );
  }
  return actionType;
}

/**
 * Presentation is a frozen, read-only content concern. The integration layer
 * must never expose internal action codes as player copy or ask a Provider to
 * invent labels during GET /game.
 */
export interface SangtianActionPresentationCatalogPortV1 {
  read(input: Readonly<{
    contentPackageVersion: string;
    contentPackageHash: string;
    chapterId: ChapterIdV1;
    decisionPointId: string;
    actionType: string;
  }>): Readonly<{
    actionType: string;
    preferredEntry: PressureGameWorkbenchV1;
    label: string;
    description: string;
  }>;
}

/** Read-only presentation adapter backed by the hash-verified release catalog. */
export class SangtianReleaseActionPresentationCatalogAdapterV1
implements SangtianActionPresentationCatalogPortV1 {
  constructor(
    private readonly release: PublishedSangtianActionReleaseV1 =
      loadPublishedSangtianActionReleaseV1(),
  ) {}

  read(input: Readonly<{
    contentPackageVersion: string;
    contentPackageHash: string;
    chapterId: ChapterIdV1;
    decisionPointId: string;
    actionType: string;
  }>): Readonly<{
    actionType: string;
    preferredEntry: PressureGameWorkbenchV1;
    label: string;
    description: string;
  }> {
    try {
      return this.release.readActionPresentation({
        contentPackageVersion: input.contentPackageVersion,
        contentPackageHash: input.contentPackageHash,
        chapterId: input.chapterId,
        decisionPointKey: input.decisionPointId,
        actionType: input.actionType,
      });
    } catch (error) {
      return failPressureChapterIntegration(
        "INTEGRATION_CONTENT_MISMATCH",
        "game.actionPresentation",
        error instanceof Error ? error.message : "RELEASE_CATALOG_FAILED",
      );
    }
  }
}

function isPublishedWorkbenchEntryV1(
  value: unknown,
): value is PressureGameWorkbenchV1 {
  return value === "TALK"
    || value === "INVESTIGATE"
    || value === "TOKEN"
    || value === "PLAN"
    || value === "DEFER";
}

function closeFactRef(
  definition: AuthoredChapterRuntimeV1["decisions"][number]["execution"],
): string {
  const condition = definition.closeCondition;
  if (
    condition.op !== "COMPARE"
    || condition.comparator !== "EQ"
    || condition.value !== true
  ) {
    failPressureChapterIntegration(
      "INTEGRATION_CONTENT_MISMATCH",
      `decision.${definition.decisionPointKey}.closeCondition`,
      "EXPECTED_BOOLEAN_FACT",
    );
  }
  return condition.factRef;
}

function chapterNumber(chapterId: ChapterIdV1): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return Number(chapterId.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

function assertAcceptedContentRoute(
  value: RunRouteSnapshotV1,
  manifest: ReturnType<typeof loadSangtianPressureChapterPackageV1>["manifest"],
): RunRouteSnapshotV1 {
  const route = validateRunRouteSnapshotV1(value);
  if (
    route.contentPackageVersion !== manifest.packageVersion
    || route.contentPackageSha256 !== manifest.contentSha256
    || route.route.runtimeProfile !== manifest.runtimeProfile
  ) {
    failPressureChapterIntegration(
      "INTEGRATION_CONTENT_MISMATCH",
      "route.contentPackage",
      "ACCEPTED_PACKAGE_REQUIRED",
    );
  }
  return route;
}
