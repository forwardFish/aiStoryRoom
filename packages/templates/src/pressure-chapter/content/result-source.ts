import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  validateFrozenSangtianResultCatalogV1,
  validateSangtianFinaleInputV1,
  validateTerminalResultContextV1,
  type FrozenResultReferenceV1,
  type FrozenRunRouteV1,
  type FrozenSangtianResultCatalogV1,
  type ParticipantModeV1,
  type SangtianFinaleInputV1,
  type SeatIdV1,
  type TerminalResultContextV1,
} from "@ai-story/shared";
import {
  SANGTIAN_CONTENT_ERROR_CODES_V1 as ERROR,
  failSangtianContentV1,
} from "./errors";
import { loadSangtianPressureChapterPackageV1 } from "./loader";
import type { LoadedSangtianPressureChapterPackageV1 } from "./types";

export interface CompileTerminalResultContextInputV1 {
  roomId: string;
  participantMode: ParticipantModeV1;
  completedAt: string;
  frozenRoute: FrozenRunRouteV1;
  resultContractRegistryVersion: string;
  narrativeProfileVersion: string;
  finaleInput: SangtianFinaleInputV1;
  package?: LoadedSangtianPressureChapterPackageV1;
}

const WORLD_PRESENTATION = Object.freeze({
  EAST_SOUTH_COLLAPSE: {
    sourceRuleRef: "world.01.east_south_collapse",
    title: "东南崩局",
    verdictLine: "民生与军饷同时跌破底线，浙江失去维持共同秩序的能力。",
    summary: "粮食、土地、军饷与地方秩序互相拖垮，六席都必须承担同一世界的崩解后果。",
  },
  TRUTH_WITH_POLITICAL_SHOCK: {
    sourceRuleRef: "world.02.truth_with_political_shock",
    title: "真相震朝",
    verdictLine: "责任链被正式采用，但它同时击穿了朝局的稳定边界。",
    summary: "证据抵达更高层级，制度真相得以保留，代价是中央政治秩序发生公开震荡。",
  },
  BALANCED_SURVIVAL: {
    sourceRuleRef: "world.03.balanced_survival",
    title: "艰难共存",
    verdictLine: "五条世界轨迹共同越过生存线，浙江以可追溯的代价维持下来。",
    summary: "民生、改桑、财政军饷、责任证据和朝局没有互相吞没，六席形成了可继续治理的平衡。",
  },
  FISCAL_ORDER_AT_CIVIL_COST: {
    sourceRuleRef: "world.04.fiscal_order_at_civil_cost",
    title: "财成民伤",
    verdictLine: "财政秩序被保住，但主要代价被压向土地与百姓。",
    summary: "中央目标与军饷得到回应，赈济和土地保全却不足，世界结局留下明确的民生成本。",
  },
  CIVIL_RELIEF_AT_WAR_COST: {
    sourceRuleRef: "world.05.civil_relief_at_war_cost",
    title: "救民误军",
    verdictLine: "百姓与田地得到保护，前线军饷却没有越过安全线。",
    summary: "地方避免了最坏的人道代价，但军务与财政压力被推迟到结局之后。",
  },
  SCAPEGOAT_STABILITY: {
    sourceRuleRef: "world.06.scapegoat_stability",
    title: "替罪之稳",
    verdictLine: "朝局表面稳定，责任却被封在少数替罪者身上。",
    summary: "制度继续运转，但证据采用层级不足，共同危机没有得到完整、可追溯的解释。",
  },
  UNRESOLVED_COMPROMISE: {
    sourceRuleRef: "world.07.unresolved_compromise",
    title: "未决妥协",
    verdictLine: "六席避免了单一崩局，也没有形成足以终结争议的共同答案。",
    summary: "多条轨迹相互抵消，世界暂时存续，未解决的责任与代价成为重玩的明确入口。",
  },
} as const);

/** Freeze all presentation and ACL inputs before the authority transaction. */
export function compileTerminalResultContextV1(
  request: CompileTerminalResultContextInputV1,
): TerminalResultContextV1 {
  const input = validateSangtianFinaleInputV1(request.finaleInput);
  const loaded = request.package ?? loadSangtianPressureChapterPackageV1();
  const catalog = compileFrozenSangtianResultCatalogV1(input, loaded);
  const withoutHash = {
    schemaVersion: "terminal_result_context_v1" as const,
    roomId: request.roomId,
    runId: input.runId,
    worldId: "sangtian" as const,
    participantMode: request.participantMode,
    completedAt: request.completedAt,
    frozenRoute: structuredClone(request.frozenRoute),
    frozenRouteHash: input.routeHash,
    resultContractRegistryVersion: request.resultContractRegistryVersion,
    payloadSchemaVersion: "sangtian_pressure_result_v1" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    narrativeProfileVersion: request.narrativeProfileVersion,
    catalog,
  };
  return validateTerminalResultContextV1({
    ...withoutHash,
    contextHash: sha256Canonical(withoutHash),
  });
}

export function compileFrozenSangtianResultCatalogV1(
  inputValue: SangtianFinaleInputV1,
  loaded = loadSangtianPressureChapterPackageV1(),
): FrozenSangtianResultCatalogV1 {
  const input = validateSangtianFinaleInputV1(inputValue);
  const referenceIds = collectReferenceIds(input, loaded);
  const references = referenceIds.map((referenceId) =>
    compileReference(referenceId, input, loaded),
  );
  const withoutHash = {
    schemaVersion: "frozen_sangtian_result_catalog_v1" as const,
    locale: "zh-CN" as const,
    worldOutcomes: Object.entries(WORLD_PRESENTATION).map(([outcomeId, item]) => ({
      outcomeId,
      ...item,
    })).sort((left, right) => compareCanonicalText(left.outcomeId, right.outcomeId)),
    tracks: loaded.content.genesis.tracks.map((track) => ({
      trackId: track.trackId,
      label: track.name,
      summaries: { LOW: track.low, MID: track.mid, HIGH: track.high },
    })),
    seats: loaded.content.genesis.seats.map((seat) => ({
      seatId: seat.seatId,
      roleKey: `role.${seat.seatId}`,
      roleName: seat.displayName,
      verdictLabels: {
        WIN: "达成制度目标",
        COSTLY_WIN: "付出代价后达成目标",
        LOSS: "未达成制度目标",
      },
    })),
    references,
    replayHint: "重新开始同一冻结版本，改变正式行动与六席协作，观察另一条共同世界结局。",
  };
  return validateFrozenSangtianResultCatalogV1({
    ...withoutHash,
    catalogHash: sha256Canonical(withoutHash),
  });
}

function collectReferenceIds(
  input: SangtianFinaleInputV1,
  loaded: LoadedSangtianPressureChapterPackageV1,
): string[] {
  const edges = [
    ...input.causalEdges,
    ...input.frozenChapterBundles.flatMap((bundle) => bundle.causalEdges),
  ];
  return sortedUnique([
    ...loaded.content.finale.worldOutcomeRuleRefs,
    ...Object.values(loaded.content.finale.seatVerdictRuleRefs).flat(),
    ...loaded.content.genesis.evidence.flatMap((item) => [item.evidenceId, ...item.supportsFactRefs]),
    ...loaded.content.genesis.responsibilities.flatMap((item) => [item.responsibilityId, ...item.sourceFactRefs]),
    ...input.finalWorldState.objects.flatMap((item) => [
      `object.${item.objectId}.v${item.version}.${item.stateCode}`,
      ...item.factRefs,
    ]),
    ...input.finalWorldState.evidence.flatMap((item) => [item.evidenceId, ...item.supportsFactRefs]),
    ...input.finalWorldState.responsibilities.flatMap((item) => [item.responsibilityId, ...item.sourceFactRefs]),
    ...Object.values(input.finalWorldState.seatArcs).flatMap((item) => [
      ...item.gainRefs, ...item.lossRefs, ...item.costRefs,
    ]),
    ...edges.flatMap((edge) => [edge.causeRef, edge.effectRef, ...edge.evidenceRefs]),
  ]);
}

function compileReference(
  referenceId: string,
  input: SangtianFinaleInputV1,
  loaded: LoadedSangtianPressureChapterPackageV1,
): FrozenResultReferenceV1 {
  const stageId = stageForReference(referenceId);
  const bundle = stageId === "P0"
    ? null
    : input.frozenChapterBundles.find((item) => item.chapterId === stageId) ?? null;
  if (stageId !== "P0" && !bundle) invalid("resultCatalog.references", `MISSING_BUNDLE_${stageId}`);
  const knowledgeSeats = PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) =>
    input.finalWorldState.knowledgeBySeat[seatId].secretRefs.includes(referenceId),
  );
  const evidence = input.finalWorldState.evidence.find((item) =>
    item.evidenceId === referenceId || item.supportsFactRefs.includes(referenceId),
  );
  const evidenceSeats = evidence && evidence.visibilityPolicyRef !== "visibility.public.chapter_outcome"
    ? evidence.holderSeatIds
    : [];
  const authorizedSeatIds = sortedSeats([...knowledgeSeats, ...evidenceSeats]);
  const visibility = authorizedSeatIds.length ? "AUTHORIZED" as const : "PUBLIC" as const;
  const presentation = presentReference(referenceId, loaded, input);
  const sourceRefs = stageId === "P0"
    ? [...loaded.content.genesis.sourceRefs]
    : [...loaded.content.chapters.find((item) => item.chapterId === stageId)!.sourceRefs];
  return {
    referenceId,
    kind: presentation.kind,
    title: presentation.title,
    summary: presentation.summary,
    sourceRefs,
    visibility,
    authorizedSeatIds,
    privateOriginSeatId: authorizedSeatIds[0] ?? null,
    sourceStageId: stageId,
    sourceKind: stageId === "P0" ? "GENESIS" : "CHAPTER_SETTLEMENT",
    chapterSettlementId: bundle?.bundleHash ?? null,
    frozenSourceHash: bundle?.bundleHash ?? input.genesisHash,
    sourceDecisionActionIds: [],
    revealEligible: visibility === "AUTHORIZED",
    revealText: visibility === "AUTHORIZED" ? presentation.summary : null,
  };
}

function presentReference(
  referenceId: string,
  loaded: LoadedSangtianPressureChapterPackageV1,
  input: SangtianFinaleInputV1,
): { kind: FrozenResultReferenceV1["kind"]; title: string; summary: string } {
  const world = Object.entries(WORLD_PRESENTATION).find(([, value]) => value.sourceRuleRef === referenceId);
  if (world) return { kind: "RULE", title: world[1].title, summary: world[1].summary };
  const seat = loaded.content.genesis.seats.find((item) =>
    loaded.content.finale.seatVerdictRuleRefs[item.seatId].includes(referenceId),
  );
  if (seat) return { kind: "RULE", title: `${seat.displayName}制度目标`, summary: seat.institutionalMission };
  const object = loaded.content.genesis.objects.find((item) => referenceId.includes(item.objectId));
  if (object) {
    const state = input.finalWorldState.objects.find((item) => item.objectId === object.objectId);
    return {
      kind: "OBJECT",
      title: object.name,
      summary: state ? `${object.name}已冻结为 ${state.stateCode}，版本 ${state.version}。` : `${object.name}的冻结事实。`,
    };
  }
  const responsibility = input.finalWorldState.responsibilities.find((item) =>
    item.responsibilityId === referenceId || item.sourceFactRefs.includes(referenceId),
  );
  if (responsibility) {
    const owner = loaded.content.genesis.seats.find((item) => item.seatId === responsibility.subjectSeatId)!;
    return { kind: "RESPONSIBILITY", title: `${owner.displayName}责任记录`, summary: `${owner.displayName}的责任等级冻结为 ${responsibility.level}。` };
  }
  const evidence = input.finalWorldState.evidence.find((item) =>
    item.evidenceId === referenceId || item.supportsFactRefs.includes(referenceId),
  ) ?? loaded.content.genesis.evidence.find((item) =>
    item.evidenceId === referenceId || item.supportsFactRefs.includes(referenceId),
  );
  if (evidence) {
    return { kind: "EVIDENCE", title: `证据 ${evidence.evidenceId}`, summary: `该冻结证据支持：${evidence.supportsFactRefs.join("、")}。` };
  }
  const stage = stageForReference(referenceId);
  if (stage === "P0") {
    return { kind: "FACT", title: loaded.content.genesis.title, summary: loaded.content.genesis.lockedFacts.join("；") };
  }
  const chapter = loaded.content.chapters.find((item) => item.chapterId === stage);
  if (chapter && /^(?:chapter|policy|evidence)\./u.test(referenceId)) {
    return { kind: referenceId.startsWith("evidence.") ? "EVIDENCE" : "FACT", title: chapter.title, summary: `${chapter.title}唯一 ChapterSettlement 冻结的结构化事实。` };
  }
  invalid("resultCatalog.references", `UNMAPPED_${referenceId}`);
}

function stageForReference(referenceId: string): "P0" | "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7" {
  if (referenceId.startsWith("world.") || referenceId.startsWith("seat.")) return "N7";
  const match = referenceId.match(/(?:^|[._-])(N[1-7])(?:[._-]|$)/u);
  if (match) return match[1] as "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7";
  return "P0";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

function sortedSeats(values: readonly SeatIdV1[]): SeatIdV1[] {
  const set = new Set(values);
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => set.has(seatId));
}

function invalid(path: string, detail?: string): never {
  failSangtianContentV1(ERROR.FINALE_RULE_MISMATCH, path, detail);
}
