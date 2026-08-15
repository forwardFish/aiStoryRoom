import type { SeatIdV1 } from "@ai-story/shared";

export interface SangtianInitialMetricV1 {
  trackId: string;
  label: string;
  value: number;
}

export interface SangtianInitialResourceV1 {
  resourceId: string;
  label: string;
  value: number;
  displayValue: string;
}

/**
 * Player-facing N1 opening values from
 * sangtian_main_game_initial_config_v5_concrete_resources.
 * These values are projection-only until personal settlement is introduced.
 */
export const SANGTIAN_INITIAL_PLAYER_METRICS_V1 = Object.freeze([
  Object.freeze({ trackId: "fiscal_military", label: "国库余裕", value: 35 }),
  Object.freeze({ trackId: "civilian_land", label: "民心", value: 55 }),
  Object.freeze({ trackId: "evidence_responsibility", label: "粮价压力", value: 60 }),
  Object.freeze({ trackId: "mulberry_silk", label: "改桑进度", value: 8 }),
  Object.freeze({ trackId: "court_imperial_face", label: "皇帝信任", value: 45 }),
] satisfies ReadonlyArray<SangtianInitialMetricV1>);

export const SANGTIAN_INITIAL_RESOURCES_BY_SEAT_V1: Readonly<
  Record<SeatIdV1, ReadonlyArray<SangtianInitialResourceV1>>
> = Object.freeze({
  zhejiang_governor: Object.freeze([
    Object.freeze({ resourceId: "troops_ready", label: "可调兵力", value: 12_000, displayValue: "12000 人" }),
    Object.freeze({ resourceId: "military_grain", label: "军粮储备", value: 18_000, displayValue: "18000 石" }),
    Object.freeze({ resourceId: "reserve_silver", label: "备用银", value: 80_000, displayValue: "80000 两" }),
  ]),
  zhejiang_administration: Object.freeze([
    Object.freeze({ resourceId: "provincial_silver", label: "省库现银", value: 60_000, displayValue: "60000 两" }),
    Object.freeze({ resourceId: "official_grain", label: "官仓存粮", value: 30_000, displayValue: "30000 石" }),
    Object.freeze({ resourceId: "local_runners", label: "州县差役", value: 1_200, displayValue: "1200 人" }),
  ]),
  qingliu_law: Object.freeze([
    Object.freeze({ resourceId: "clerks", label: "随行书吏", value: 12, displayValue: "12 人" }),
    Object.freeze({ resourceId: "runners", label: "可调缉役", value: 80, displayValue: "80 人" }),
    Object.freeze({ resourceId: "relay_horses", label: "急递驿骑", value: 24, displayValue: "24 骑" }),
  ]),
  cabinet_finance: Object.freeze([
    Object.freeze({ resourceId: "relief_silver", label: "赈灾预备银", value: 120_000, displayValue: "120000 两" }),
    Object.freeze({ resourceId: "military_pay", label: "待拨军饷", value: 280_000, displayValue: "280000 两" }),
    Object.freeze({ resourceId: "capital_grain", label: "京仓粮储", value: 80_000, displayValue: "80000 石" }),
  ]),
  jiangnan_merchant: Object.freeze([
    Object.freeze({ resourceId: "liquid_silver", label: "流动现银", value: 350_000, displayValue: "350000 两" }),
    Object.freeze({ resourceId: "grain_stock", label: "粮食库存", value: 150_000, displayValue: "150000 石" }),
    Object.freeze({ resourceId: "grain_boats", label: "粮船", value: 100, displayValue: "100 艘" }),
  ]),
  sili_weaving: Object.freeze([
    Object.freeze({ resourceId: "weaving_silver", label: "织造局现银", value: 100_000, displayValue: "100000 两" }),
    Object.freeze({ resourceId: "raw_silk", label: "生丝库存", value: 60_000, displayValue: "60000 斤" }),
    Object.freeze({ resourceId: "official_looms", label: "官营织机", value: 1_200, displayValue: "1200 架" }),
  ]),
});
