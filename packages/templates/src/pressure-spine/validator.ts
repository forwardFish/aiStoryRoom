import { sha256Bytes } from "./canonical";
import { PressureSpineValidationError } from "./errors";
import type { PressureSpineFileMap, PressureSpineValidationIssue, PressureSpineValidationOptions, PressureSpineValidationReport } from "./types";

type Rec = Record<string, unknown>;
type Parsed = { files: PressureSpineFileMap; json: Map<string, unknown>; jsonl: Map<string, unknown[]> };
const decoder = new TextDecoder("utf-8", { fatal: true });
const SHA = /^[A-Fa-f0-9]{64}$/u;
const asRec = (v: unknown): Rec | null => v && typeof v === "object" && !Array.isArray(v) ? v as Rec : null;
const asArr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const asStr = (v: unknown): string => typeof v === "string" ? v : "";
const strArr = (v: unknown): string[] => asArr(v).filter((x): x is string => typeof x === "string");
const issue = (out: PressureSpineValidationIssue[], code: string, path: string, message: string) => out.push({ code, path, message });

function decode(bytes: Uint8Array, path: string): string {
  try { const text = decoder.decode(bytes); return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; }
  catch (error) { throw new PressureSpineValidationError("CONTENT_UTF8_INVALID", path, error instanceof Error ? error.message : String(error)); }
}
function parse(files: PressureSpineFileMap, issues: PressureSpineValidationIssue[]): Parsed {
  const json = new Map<string, unknown>(); const jsonl = new Map<string, unknown[]>();
  for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!path.endsWith(".json") && !path.endsWith(".jsonl")) continue;
    let text: string;
    try { text = decode(bytes, path); } catch (error) { const e = error as PressureSpineValidationError; issue(issues, e.code, e.path, e.message); continue; }
    if (path.endsWith(".json")) {
      try { json.set(path, JSON.parse(text)); } catch (error) { issue(issues, "CONTENT_JSON_INVALID", path, String(error)); }
    } else {
      const rows: unknown[] = [];
      for (const [i, line] of text.split(/\r?\n/u).entries()) if (line.trim()) {
        try { rows.push(JSON.parse(line)); } catch (error) { issue(issues, "CONTENT_JSONL_INVALID", `${path}#L${i + 1}`, String(error)); }
      }
      jsonl.set(path, rows);
    }
  }
  return { files, json, jsonl };
}
function req(parsed: Parsed, path: string, issues: PressureSpineValidationIssue[]): Rec {
  const value = asRec(parsed.json.get(path));
  if (!value) issue(issues, "CONTENT_REQUIRED_FILE_INVALID", path, "required JSON object missing or invalid");
  return value || {};
}
function reg(ids: Map<string, string>, value: unknown, path: string, issues: PressureSpineValidationIssue[]) {
  const id = asStr(value);
  if (!id) return issue(issues, "CONTENT_STABLE_ID_MISSING", path, "stable ID required");
  const old = ids.get(id);
  if (old) issue(issues, "CONTENT_STABLE_ID_DUPLICATE", path, `${id} already defined at ${old}`); else ids.set(id, path);
}
function same(a: Iterable<string>, b: Iterable<string>) { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }

function validateInventory(parsed: Parsed, issues: PressureSpineValidationIssue[]) {
  const inv = asRec(parsed.json.get("inventory.json"));
  if (!inv) return issue(issues, "CONTENT_INVENTORY_MISSING", "inventory.json", "inventory required");
  const rows = asArr(inv.files).map(asRec).filter((x): x is Rec => Boolean(x));
  const byPath = new Map(rows.map((r) => [asStr(r.path), r]));
  if (!same(parsed.files.keys(), byPath.keys())) issue(issues, "CONTENT_INVENTORY_FILE_SET_MISMATCH", "inventory.json#/files", `inventory=${byPath.size}; actual=${parsed.files.size}`);
  for (const [path, bytes] of parsed.files) {
    const row = byPath.get(path); if (!row) continue;
    if (Number(row.byteSize) !== bytes.byteLength) issue(issues, "CONTENT_INVENTORY_SIZE_MISMATCH", `inventory.json#/files/${path}`, `expected=${row.byteSize}; actual=${bytes.byteLength}`);
    const expected = asStr(row.sha256).toUpperCase();
    if (!SHA.test(expected)) issue(issues, "CONTENT_INVENTORY_HASH_INVALID", `inventory.json#/files/${path}/sha256`, "invalid SHA-256");
    else if (path === "inventory.json") {
      const clone = JSON.parse(decode(bytes, path)) as Rec;
      const self = asArr(clone.files).map(asRec).find((x) => x?.path === "inventory.json");
      if (!self) issue(issues, "CONTENT_INVENTORY_SELF_MISSING", "inventory.json#/files", "self record missing");
      else { const stored = asStr(self.sha256).toUpperCase(); self.sha256 = "0".repeat(64); const actual = sha256Bytes(`${JSON.stringify(clone, null, 2)}\n`); if (stored !== actual) issue(issues, "CONTENT_INVENTORY_HASH_MISMATCH", "inventory.json#/files/inventory.json", `expected=${stored}; actual=${actual}`); }
    } else {
      const actual = sha256Bytes(bytes); if (actual !== expected) issue(issues, "CONTENT_INVENTORY_HASH_MISMATCH", `inventory.json#/files/${path}`, `expected=${expected}; actual=${actual}`);
    }
  }
}

function selector(ruleValue: unknown, state: Rec): boolean {
  const rule = asRec(ruleValue) || {};
  if (Array.isArray(rule.all)) return rule.all.every((x) => selector(x, state));
  if (Array.isArray(rule.any)) return rule.any.some((x) => selector(x, state));
  if (rule.otherwise === true) return true;
  let actual: unknown;
  const expr = asStr(rule.expr);
  if (expr.startsWith("min(") && expr.endsWith(")")) actual = Math.min(...expr.slice(4, -1).split(",").map((x) => Number(state[x.trim()])));
  else actual = state[asStr(rule.key)];
  const expected = rule.value; const op = asStr(rule.op);
  if (op === ">=") return Number(actual) >= Number(expected);
  if (op === "<=") return Number(actual) <= Number(expected);
  if (op === ">") return Number(actual) > Number(expected);
  if (op === "<") return Number(actual) < Number(expected);
  if (op === "==" || op === "EQ") return actual === expected;
  if (op === "IN") return Array.isArray(expected) && expected.includes(actual);
  throw new Error(`unsupported operator ${op}`);
}

function validateSourceRefs(parsed: Parsed, claims: Map<string, Rec>, sourceSha: string, issues: PressureSpineValidationIssue[], options: PressureSpineValidationOptions) {
  const map = asRec(parsed.json.get("validation/source-index-reference-map.json")) || {};
  const paragraphs = asRec(map.paragraphs) || {};
  let lines: string[] | null = null;
  if (options.sourceText !== undefined) {
    const raw = options.sourceText.replace(/^\uFEFF/u, "");
    const rawHash = sha256Bytes(new TextEncoder().encode(raw));
    if (rawHash !== sourceSha) issue(issues, "CONTENT_SOURCE_SHA_MISMATCH", "sourceText", `expected=${sourceSha}; actual=${rawHash}`);
    lines = raw.replace(/\r\n?/gu, "\n").split("\n"); if (lines.at(-1) === "") lines.pop();
  }
  for (const [claimId, claim] of claims) {
    const provenance = asStr(claim.provenanceClass);
    if (provenance === "SOURCE_FACT") {
      const refs = asArr(claim.sourceRefs).map(asRec).filter((x): x is Rec => Boolean(x));
      if (!refs.length) issue(issues, "CONTENT_SOURCE_REF_INVALID", `${claimId}#/sourceRefs`, "SOURCE_FACT requires sourceRefs");
      for (const [i, ref] of refs.entries()) {
        const p = `${claimId}#/sourceRefs/${i}`; const start = Number(ref.lineStart); const end = Number(ref.lineEnd);
        if (asStr(ref.sourceSha256).toUpperCase() !== sourceSha || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || (options.expectedSourceLineCount && end > options.expectedSourceLineCount)) issue(issues, "CONTENT_SOURCE_REF_INVALID", p, "source identity or line range invalid");
        const ps = asRec(paragraphs[asStr(ref.paragraphStartId)]); const pe = asRec(paragraphs[asStr(ref.paragraphEndId)]);
        if (!ps || !pe || asStr(ps.sectionId) !== asStr(ref.chapterId) || asStr(pe.sectionId) !== asStr(ref.chapterId) || start < Number(ps.lineStart) || end > Number(pe.lineEnd)) issue(issues, "CONTENT_SOURCE_REF_INVALID", p, "paragraph/chapter/line reference invalid");
        if (lines && start >= 1 && end <= lines.length) {
          const span = lines.slice(start - 1, end).join("\n"); const actual = sha256Bytes(span);
          if (actual !== asStr(ref.textSpanSha256).toUpperCase()) issue(issues, "CONTENT_SOURCE_REF_INVALID", `${p}/textSpanSha256`, `expected=${ref.textSpanSha256}; actual=${actual}`);
        }
      }
    } else if (provenance === "ADAPTATION_RULE") {
      if (!asStr(claim.adaptationDecisionId)) issue(issues, "CONTENT_ADAPTATION_INVALID", claimId, "ADAPTATION_RULE requires adaptationDecisionId");
    } else if (provenance === "INFERENCE") {
      if (!strArr(claim.supportClaimIds).length || !["strong", "medium", "weak"].includes(asStr(claim.certainty))) issue(issues, "CONTENT_INFERENCE_INVALID", claimId, "INFERENCE requires supportClaimIds and certainty");
    } else if (provenance === "UNKNOWN") {
      if (claim.narratorRule !== "FORBIDDEN_AS_FACT") issue(issues, "CONTENT_UNKNOWN_PROMOTED", claimId, "UNKNOWN must be forbidden as fact");
    } else issue(issues, "CONTENT_PROVENANCE_INVALID", `${claimId}#/provenanceClass`, `unsupported provenance ${provenance}`);
  }
}

export function validatePressureSpinePackage(files: PressureSpineFileMap, options: PressureSpineValidationOptions = {}): PressureSpineValidationReport {
  const issues: PressureSpineValidationIssue[] = []; const parsed = parse(files, issues);
  if (options.validateInventory !== false) validateInventory(parsed, issues);
  const manifest = req(parsed, "manifest.json", issues);
  const packageId = asStr(manifest.packageId); const packageVersion = asStr(manifest.packageVersion); const sourceSha = asStr(manifest.sourceSha256).toUpperCase();
  if (!asStr(manifest.schemaVersion).includes("content_manifest") || !packageId || !packageVersion) issue(issues, "CONTENT_SCHEMA_PROFILE_MISMATCH", "manifest.json", "accepted pressure content manifest required");
  if (!SHA.test(sourceSha)) issue(issues, "CONTENT_SOURCE_SHA_INVALID", "manifest.json#/sourceSha256", "invalid SHA-256");
  if (options.expectedSourceSha256 && sourceSha !== options.expectedSourceSha256.toUpperCase()) issue(issues, "CONTENT_SOURCE_SHA_MISMATCH", "manifest.json#/sourceSha256", `expected=${options.expectedSourceSha256}; actual=${sourceSha}`);
  if (options.expectedSourceLineCount && Number(manifest.sourceLineCount) !== options.expectedSourceLineCount) issue(issues, "CONTENT_SOURCE_LINE_COUNT_MISMATCH", "manifest.json#/sourceLineCount", `expected=${options.expectedSourceLineCount}; actual=${manifest.sourceLineCount}`);
  const declaredFiles = strArr(manifest.files); if (declaredFiles.length && !same(declaredFiles, files.keys())) issue(issues, "CONTENT_MANIFEST_FILE_SET_MISMATCH", "manifest.json#/files", "manifest file set differs from directory");
  const nodeIds = strArr(manifest.nodes); const declaredSeats = new Set(strArr(manifest.seatIds));
  if (!nodeIds.length || nodeIds[0] !== "P0" || new Set(nodeIds).size !== nodeIds.length) issue(issues, "CONTENT_NODE_COVERAGE_INVALID", "manifest.json#/nodes", "ordered unique nodes beginning P0 required");
  if (options.expectedNodeIds && !same(nodeIds, options.expectedNodeIds)) issue(issues, "CONTENT_NODE_COVERAGE_INVALID", "manifest.json#/nodes", `expected=${options.expectedNodeIds.join(",")}; actual=${nodeIds.join(",")}`);
  const order = new Map(nodeIds.map((id, i) => [id, i])); const stableIds = new Map<string, string>();

  const seats = asArr(req(parsed, "global/seats.json", issues).seats).map(asRec).filter((x): x is Rec => Boolean(x));
  const seatIds = new Set<string>(); const roleKeys = new Set<string>();
  seats.forEach((s, i) => { reg(stableIds, s.seatId, `global/seats.json#/seats/${i}/seatId`, issues); seatIds.add(asStr(s.seatId)); const key=asStr(s.roleKey); if (!key || roleKeys.has(key)) issue(issues,"CONTENT_SEAT_CONTRACT_INVALID",`global/seats.json#/seats/${i}/roleKey`,"unique roleKey required"); roleKeys.add(key); });
  if (!same(seatIds, declaredSeats) || (options.expectedSeatCount && seatIds.size !== options.expectedSeatCount)) issue(issues, "CONTENT_SEAT_CONTRACT_INVALID", "manifest.json#/seatIds", "manifest/global seat set mismatch");
  const actors = new Map<string, Rec>();
  asArr(req(parsed,"global/actors.json",issues).actors).map(asRec).filter((x): x is Rec=>Boolean(x)).forEach((a,i)=>{ reg(stableIds,a.actorId,`global/actors.json#/actors/${i}/actorId`,issues); actors.set(asStr(a.actorId),a); if (a.seatId != null && !seatIds.has(asStr(a.seatId))) issue(issues,"CONTENT_ACTOR_SEAT_INVALID",`global/actors.json#/actors/${i}/seatId`,"unknown seat"); if (!order.has(asStr(a.activeFrom)) || (asStr(a.activeUntil)!=="FINALE" && !order.has(asStr(a.activeUntil)))) issue(issues,"CONTENT_ACTOR_RANGE_INVALID",`global/actors.json#/actors/${i}`,"invalid active range"); });
  const objectIds = new Set<string>();
  asArr(req(parsed,"global/objects.json",issues).objects).map(asRec).filter((x):x is Rec=>Boolean(x)).forEach((o,i)=>{reg(stableIds,o.objectId,`global/objects.json#/objects/${i}/objectId`,issues);objectIds.add(asStr(o.objectId));});
  const handoffs = new Map<string, Rec>();
  asArr(req(parsed,"global/knowledge-and-handoffs.json",issues).handoffs).map(asRec).filter((x):x is Rec=>Boolean(x)).forEach((h,i)=>{reg(stableIds,h.handoffId,`global/knowledge-and-handoffs.json#/handoffs/${i}/handoffId`,issues);handoffs.set(asStr(h.handoffId),h);if(!seatIds.has(asStr(h.seatId))||!actors.has(asStr(h.fromActorId))||!actors.has(asStr(h.toActorId))||!order.has(asStr(h.afterNode))) issue(issues,"CONTENT_HANDOFF_INVALID",`global/knowledge-and-handoffs.json#/handoffs/${i}`,"invalid handoff reference");});

  const claims=new Map<string,Rec>(), adaptations=new Set<string>(), scenes=new Map<string,Rec>(), flows=new Map<string,Rec>(), settlements=new Map<string,Rec>();
  const branchIds=new Set<string>(), frozenIds=new Set<string>(), openingIds=new Set<string>(), versionIds=new Set<string>(), dialogueIds=new Set<string>();
  const frozenFactsByResult=new Map<string,Set<string>>(), versionsByResult=new Map<string,Set<string>>();

  for (const nodeId of nodeIds) {
    const base=`nodes/${nodeId}`; const node=req(parsed,`${base}/node.json`,issues); reg(stableIds,node.nodeId,`${base}/node.json#/nodeId`,issues);
    if(asStr(node.nodeId)!==nodeId) issue(issues,"CONTENT_NODE_ID_MISMATCH",`${base}/node.json#/nodeId`,`expected ${nodeId}`);
    if(asStr(node.sourceSha256).toUpperCase()!==sourceSha) issue(issues,"CONTENT_SOURCE_SHA_MISMATCH",`${base}/node.json#/sourceSha256`,"node source SHA mismatch");
    for(const id of [...strArr(node.contestedObjectIds),...strArr(node.secondaryObjectIds)]) if(!objectIds.has(id)) issue(issues,"CONTENT_OBJECT_REFERENCE_INVALID",`${base}/node.json#/contestedObjectIds`,`unknown ${id}`);
    for(const [i,v] of (parsed.jsonl.get(`${base}/source-evidence.jsonl`)||[]).entries()){const c=asRec(v)||{};reg(stableIds,c.claimId,`${base}/source-evidence.jsonl#/${i}/claimId`,issues);claims.set(asStr(c.claimId),c);if(asStr(c.nodeId)!==nodeId)issue(issues,"CONTENT_CLAIM_NODE_MISMATCH",`${base}/source-evidence.jsonl#/${i}/nodeId`,`expected ${nodeId}`);if(!strArr(c.knownBy).every(x=>seatIds.has(x)))issue(issues,"CONTENT_KNOWLEDGE_REFERENCE_INVALID",`${base}/source-evidence.jsonl#/${i}/knownBy`,"unknown seat");}
    const ad=req(parsed,`${base}/adaptations.json`,issues);asArr(ad.adaptations).map(asRec).filter((x):x is Rec=>Boolean(x)).forEach((a,i)=>{reg(stableIds,a.adaptationDecisionId,`${base}/adaptations.json#/adaptations/${i}/adaptationDecisionId`,issues);adaptations.add(asStr(a.adaptationDecisionId));if(a.reviewStatus!=="APPROVED"||!asStr(a.rationale)||!strArr(a.invariantsToPreserve).length)issue(issues,"CONTENT_ADAPTATION_INVALID",`${base}/adaptations.json#/adaptations/${i}`,"approved rationale/invariants required");});
    const flow=req(parsed,`${base}/scene-flow.json`,issues);flows.set(nodeId,flow);
    asArr(flow.decisionBeats).map(asRec).filter((x):x is Rec=>Boolean(x)).forEach((b,i)=>reg(stableIds,b.beatId,`${base}/scene-flow.json#/decisionBeats/${i}/beatId`,issues));
    for(const [i,s] of asArr(flow.scenes).map(asRec).filter((x):x is Rec=>Boolean(x)).entries()){
      reg(stableIds,s.sceneId,`${base}/scene-flow.json#/scenes/${i}/sceneId`,issues); const id=asStr(s.sceneId); scenes.set(id,s);
      if(asStr(s.nodeId)!==nodeId)issue(issues,"CONTENT_SCENE_NODE_MISMATCH",`${base}/scene-flow.json#/scenes/${i}/nodeId`,`expected ${nodeId}`);
      const known=new Set(strArr(s.knownBy)); if(![...known].every(x=>seatIds.has(x)))issue(issues,"CONTENT_KNOWLEDGE_REFERENCE_INVALID",`${id}#/knownBy`,"unknown seat");
      if(s.visibility==="PUBLIC"&&!same(known,seatIds))issue(issues,"CONTENT_KNOWLEDGE_UNAUTHORIZED",`${id}#/knownBy`,"public scene must include all seats");
      for(const claimId of strArr(s.sourceClaimIds)){const c=claims.get(claimId);if(!c)issue(issues,"CONTENT_CLAIM_REFERENCE_INVALID",`${id}#/sourceClaimIds`,`unknown ${claimId}`);else if(![...known].every(seat=>strArr(c.knownBy).includes(seat)))issue(issues,"CONTENT_KNOWLEDGE_UNAUTHORIZED",`${id}#/sourceClaimIds`,`claim ${claimId} not known by all scene audience`);}
      for(const objectId of strArr(s.applicableObjectIds))if(!objectIds.has(objectId))issue(issues,"CONTENT_OBJECT_REFERENCE_INVALID",`${id}#/applicableObjectIds`,`unknown ${objectId}`);
      for(const [j,v] of asArr(s.openingProjectionVariants).map(asRec).filter((x):x is Rec=>Boolean(x)).entries()){reg(stableIds,v.openingProjectionId,`${id}#/openingProjectionVariants/${j}/openingProjectionId`,issues);openingIds.add(asStr(v.openingProjectionId));}
    }
    for(const [i,r] of asArr(flow.inputRealizations).map(asRec).filter((x):x is Rec=>Boolean(x)).entries())reg(stableIds,r.inputId,`${base}/scene-flow.json#/inputRealizations/${i}/inputId`,issues);

    const sc=req(parsed,`${base}/seat-content.json`,issues); const perSeat=new Set<string>();
    for(const [i,s] of asArr(sc.seats).map(asRec).filter((x):x is Rec=>Boolean(x)).entries()){
      reg(stableIds,s.seatContentId,`${base}/seat-content.json#/seats/${i}/seatContentId`,issues);const seatId=asStr(s.seatId);perSeat.add(seatId);const actorId=asStr(s.currentActorId);const actor=actors.get(actorId);
      if(!seatIds.has(seatId)||!actor||asStr(actor.seatId)!==seatId)issue(issues,"CONTENT_KNOWLEDGE_ACTOR_INVALID",`${base}/seat-content.json#/seats/${i}`,"seat/current actor mismatch");
      const pos=order.get(nodeId)??-1;if(actor){const from=order.get(asStr(actor.activeFrom))??-1;const until=asStr(actor.activeUntil)==="FINALE"?Infinity:(order.get(asStr(actor.activeUntil))??-1);if(pos<from||pos>until)issue(issues,"CONTENT_KNOWLEDGE_ACTOR_INVALID",`${base}/seat-content.json#/seats/${i}/currentActorId`,"actor inactive at node");}
      for(const [kind,listName] of [["known","knownFacts"],["unknown","unknownFacts"]] as const){for(const [j,f] of asArr(s[listName]).map(asRec).filter((x):x is Rec=>Boolean(x)).entries()){reg(stableIds,f.factRefId,`${base}/seat-content.json#/seats/${i}/${listName}/${j}/factRefId`,issues);if(asStr(f.currentActorId)!==actorId)issue(issues,"CONTENT_KNOWLEDGE_ACTOR_INVALID",`${asStr(f.factRefId)}#/currentActorId`,"fact actor mismatch");if(asStr(f.sourceKind)==="CLAIM"){const c=claims.get(asStr(f.claimId));if(!c)issue(issues,"CONTENT_CLAIM_REFERENCE_INVALID",`${asStr(f.factRefId)}#/claimId`,"unknown claim");else if(kind==="known"&&!strArr(c.knownBy).includes(seatId))issue(issues,"CONTENT_KNOWLEDGE_UNAUTHORIZED",`${asStr(f.factRefId)}#/claimId`,"seat is not authorized for claim");else if(kind==="unknown"&&strArr(c.knownBy).includes(seatId)&&!asStr(f.narratorRule))issue(issues,"CONTENT_KNOWLEDGE_UNAUTHORIZED",`${asStr(f.factRefId)}#/claimId`,"claim marked unknown despite authorization");}if(asStr(f.sourceKind)==="OBJECT_STATE"&&!objectIds.has(asStr(f.objectId)))issue(issues,"CONTENT_OBJECT_REFERENCE_INVALID",`${asStr(f.factRefId)}#/objectId`,"unknown object");if(asStr(f.sourceKind)==="HANDOFF"&&!handoffs.has(asStr(f.handoffId)))issue(issues,"CONTENT_HANDOFF_INVALID",`${asStr(f.factRefId)}#/handoffId`,"unknown handoff");}}
      if(!same(strArr(s.knownFactIds),asArr(s.knownFacts).map(asRec).map(x=>asStr(x?.factRefId)).filter(Boolean)))issue(issues,"CONTENT_KNOWLEDGE_INDEX_INVALID",`${base}/seat-content.json#/seats/${i}/knownFactIds`,"known fact index mismatch");
      if(!same(strArr(s.unknownFactIds),asArr(s.unknownFacts).map(asRec).map(x=>asStr(x?.factRefId)).filter(Boolean)))issue(issues,"CONTENT_KNOWLEDGE_INDEX_INVALID",`${base}/seat-content.json#/seats/${i}/unknownFactIds`,"unknown fact index mismatch");
      for(const [j,d] of asArr(s.dialogueSeeds).map(asRec).filter((x):x is Rec=>Boolean(x)).entries()){reg(stableIds,d.dialogueSeedId,`${base}/seat-content.json#/seats/${i}/dialogueSeeds/${j}/dialogueSeedId`,issues);dialogueIds.add(asStr(d.dialogueSeedId));if(!strArr(d.knownBy).includes(seatId))issue(issues,"CONTENT_KNOWLEDGE_UNAUTHORIZED",`${asStr(d.dialogueSeedId)}#/knownBy`,"dialogue not known by seat");}
    }
    if(!same(perSeat,seatIds))issue(issues,"CONTENT_SEAT_COVERAGE_INVALID",`${base}/seat-content.json#/seats`,"each node requires every seat");

    const defaults=req(parsed,`${base}/npc-defaults.json`,issues);for(const [i,d] of asArr(defaults.seatDefaults).map(asRec).filter((x):x is Rec=>Boolean(x)).entries()){reg(stableIds,d.defaultPolicyId,`${base}/npc-defaults.json#/seatDefaults/${i}/defaultPolicyId`,issues);if(!seatIds.has(asStr(d.seatId))||!actors.has(asStr(d.currentActorId)))issue(issues,"CONTENT_DEFAULT_POLICY_INVALID",`${base}/npc-defaults.json#/seatDefaults/${i}`,"invalid seat/actor");}for(const [i,d] of asArr(defaults.inputFallbackPolicies).map(asRec).filter((x):x is Rec=>Boolean(x)).entries())reg(stableIds,d.fallbackId,`${base}/npc-defaults.json#/inputFallbackPolicies/${i}/fallbackId`,issues);

    const settlement=req(parsed,`${base}/settlement.json`,issues);settlements.set(nodeId,settlement);const branches=asArr(settlement.branches).map(asRec).filter((x):x is Rec=>Boolean(x));
    for(const [i,b] of branches.entries()){reg(stableIds,b.branchId,`${base}/settlement.json#/branches/${i}/branchId`,issues);reg(stableIds,b.frozenResultId,`${base}/settlement.json#/branches/${i}/frozenResultId`,issues);branchIds.add(asStr(b.branchId));frozenIds.add(asStr(b.frozenResultId));const facts=new Set<string>();for(const [j,f] of asArr(b.frozenFactsById).map(asRec).filter((x):x is Rec=>Boolean(x)).entries()){reg(stableIds,f.frozenFactId,`${base}/settlement.json#/branches/${i}/frozenFactsById/${j}/frozenFactId`,issues);facts.add(asStr(f.frozenFactId));}if(!same(facts,strArr(b.frozenFactIds)))issue(issues,"CONTENT_FROZEN_RESULT_INVALID",`${base}/settlement.json#/branches/${i}/frozenFactIds`,"frozen facts index mismatch");frozenFactsByResult.set(asStr(b.frozenResultId),facts);const versions=new Set<string>();for(const [j,o] of asArr(b.objectOutcomes).map(asRec).filter((x):x is Rec=>Boolean(x)).entries()){const objectId=asStr(o.objectId),version=asStr(o.versionId);if(!objectIds.has(objectId)||!version.startsWith(`${objectId}@`))issue(issues,"CONTENT_OBJECT_VERSION_INVALID",`${base}/settlement.json#/branches/${i}/objectOutcomes/${j}/versionId`,"version does not belong to object");reg(stableIds,version,`${base}/settlement.json#/branches/${i}/objectOutcomes/${j}/versionId`,issues);versions.add(version);versionIds.add(version);if(asStr(o.availableFrom)!==asStr(b.frozenResultId)||!asStr(o.custodyMode)||!asStr(o.custodyRule)||!strArr(o.knownBy).every(x=>seatIds.has(x)))issue(issues,"CONTENT_CUSTODY_OUTCOME_INVALID",`${base}/settlement.json#/branches/${i}/objectOutcomes/${j}`,"invalid custody/version outcome");}versionsByResult.set(asStr(b.frozenResultId),versions);}
    if(nodeId!=="P0"){
      if(settlement.balanceSeedStatus!=="UNVALIDATED_BALANCE_SEED")issue(issues,"CONTENT_BRANCH_SELECTOR_INVALID",`${base}/settlement.json#/balanceSeedStatus`,"must remain UNVALIDATED_BALANCE_SEED");
      const bs=asRec(settlement.branchSelector)||{},dt=asRec(settlement.defaultTrajectory)||{},state=asRec(dt.defaultInputState)||{};let selected="";try{const selectors=asRec(bs.selectors)||{};for(const level of strArr(bs.evaluationOrder))if(selector(selectors[level],state)){selected=asStr(branches.find(x=>asStr(x.level)===level)?.branchId);break;}}catch(e){issue(issues,"CONTENT_BRANCH_SELECTOR_INVALID",`${base}/settlement.json#/branchSelector`,String(e));}if(!selected||selected!==asStr(dt.defaultBranchId))issue(issues,"CONTENT_DEFAULT_TRAJECTORY_INVALID",`${base}/settlement.json#/defaultTrajectory`,`selected=${selected}; declared=${dt.defaultBranchId}`);
    }
  }

  for(const c of claims.values())if(asStr(c.provenanceClass)==="ADAPTATION_RULE"&&!adaptations.has(asStr(c.adaptationDecisionId)))issue(issues,"CONTENT_ADAPTATION_INVALID",`${asStr(c.claimId)}#/adaptationDecisionId`,"unknown adaptation");
  for(const c of claims.values())if(asStr(c.provenanceClass)==="INFERENCE")for(const id of strArr(c.supportClaimIds))if(!claims.has(id))issue(issues,"CONTENT_INFERENCE_INVALID",`${asStr(c.claimId)}#/supportClaimIds`,`unknown ${id}`);
  validateSourceRefs(parsed,claims,sourceSha,issues,options);
  if(options.requireNativeAuditPass!==false){const audit=asRec(parsed.json.get("validation/source-ref-audit.json"));if(!audit||audit.verdict!=="PASS"||asStr(audit.sourceSha256).toUpperCase()!==sourceSha)issue(issues,"CONTENT_SOURCE_AUDIT_INVALID","validation/source-ref-audit.json","native source audit must pass");}

  for(const [id,s] of scenes){for(const targetId of strArr(s.successorIds)){const target=scenes.get(targetId);const finale=targetId==="finale.opening"&&asStr(s.nodeId)===nodeIds.at(-1);if(!target&&!finale)issue(issues,"CONTENT_GRAPH_EDGE_DANGLING",`${id}#/successorIds`,`unknown ${targetId}`);else if(target&&!strArr(target.predecessorIds).includes(id))issue(issues,"CONTENT_GRAPH_EDGE_ASYMMETRIC",`${id}#/successorIds`,`${targetId} missing reverse predecessor`);}for(const sourceId of strArr(s.predecessorIds)){const source=scenes.get(sourceId);if(!source)issue(issues,"CONTENT_GRAPH_EDGE_DANGLING",`${id}#/predecessorIds`,`unknown ${sourceId}`);else if(!strArr(source.successorIds).includes(id))issue(issues,"CONTENT_GRAPH_EDGE_ASYMMETRIC",`${id}#/predecessorIds`,`${sourceId} missing reverse successor`);}}
  const opening=asArr(flows.get(nodeIds[0])?.scenes).map(asRec).find(x=>x?.sceneType==="OPENING"&&x.visibility==="PUBLIC");const reached=new Set<string>();const stack=opening?[asStr(opening.sceneId)]:[];while(stack.length){const id=stack.pop()!;if(reached.has(id))continue;const s=scenes.get(id);if(!s)continue;reached.add(id);stack.push(...strArr(s.successorIds));}if(!opening)issue(issues,"CONTENT_GRAPH_START_MISSING","scene-flow","public opening missing");if(reached.size!==scenes.size)issue(issues,"CONTENT_GRAPH_UNREACHABLE","scene-flow",`${scenes.size-reached.size} unreachable scenes`);
  for(const nodeId of nodeIds){const node=req(parsed,`nodes/${nodeId}/node.json`,issues);if(Number((asRec(node.actionBudget)||{}).reactionPerSeat)<=0)continue;const ss=asArr(flows.get(nodeId)?.scenes).map(asRec).filter((x):x is Rec=>Boolean(x));const reaction=ss.find(x=>x.sceneType==="CONDITIONAL_REACTION"),commit=ss.find(x=>x.sceneType==="COMMIT_CONFRONTATION"),results=ss.filter(x=>x.sceneType==="SETTLEMENT_RESULT");if(!reaction||!commit||!results.length)issue(issues,"CONTENT_REACTION_PATH_INVALID",`nodes/${nodeId}/scene-flow.json`,"reaction node incomplete");else for(const r of results)if(!strArr(reaction.successorIds).includes(asStr(r.sceneId))||!strArr(commit.successorIds).includes(asStr(r.sceneId)))issue(issues,"CONTENT_REACTION_PATH_INVALID",`${nodeId}#/${asStr(r.sceneId)}`,"reaction and no-reaction paths must reach settlement");}
  for(let i=2;i<nodeIds.length;i++){const nodeId=nodeIds[i],prev=nodeIds[i-1];const openingScene=asArr(flows.get(nodeId)?.scenes).map(asRec).find(x=>x?.sceneType==="OPENING");const variants=asArr(openingScene?.openingProjectionVariants).map(asRec).filter((x):x is Rec=>Boolean(x));const byResult=new Map(variants.map(v=>[asStr(v.predecessorFrozenResultId),v]));for(const b of asArr(settlements.get(prev)?.branches).map(asRec).filter((x):x is Rec=>Boolean(x))){const fr=asStr(b.frozenResultId),v=byResult.get(fr);if(!v){issue(issues,"CONTENT_OPENING_PROJECTION_INVALID",`nodes/${nodeId}/scene-flow.json#/openingProjectionVariants`,`missing ${fr}`);continue;}if(asStr(v.predecessorBranchId)!==asStr(b.branchId))issue(issues,"CONTENT_OPENING_PROJECTION_INVALID",`${asStr(v.openingProjectionId)}#/predecessorBranchId`,"branch mismatch");const facts=frozenFactsByResult.get(fr)||new Set(),vers=versionsByResult.get(fr)||new Set();if(!strArr(v.requiredFrozenFactIds).every(x=>facts.has(x)))issue(issues,"CONTENT_OPENING_PROJECTION_INVALID",`${asStr(v.openingProjectionId)}#/requiredFrozenFactIds`,"fact absent from predecessor");if(!same(strArr(v.requiredObjectVersionIds),vers))issue(issues,"CONTENT_OPENING_PROJECTION_INVALID",`${asStr(v.openingProjectionId)}#/requiredObjectVersionIds`,"versions must exactly match predecessor outcomes");for(const p of asArr(v.seatPrivateProjections).map(asRec).filter((x):x is Rec=>Boolean(x))){if(!seatIds.has(asStr(p.seatId))||!strArr(p.grantedFrozenFactIds).every(x=>facts.has(x))||!strArr(p.grantedObjectVersionIds).every(x=>vers.has(x))){issue(issues,"CONTENT_OPENING_PROJECTION_INVALID",`${asStr(v.openingProjectionId)}#/seatPrivateProjections`,"invalid private projection");}const a=actors.get(asStr(p.currentActorId));if(!a||asStr(a.seatId)!==asStr(p.seatId))issue(issues,"CONTENT_OPENING_PROJECTION_INVALID",`${asStr(v.openingProjectionId)}#/currentActorId`,"actor/seat mismatch");}}}
  const unknowns=req(parsed,"validation/unresolved-unknowns.json",issues);if(!["PASS","PASS_WITH_EXPLICIT_UNKNOWNS"].includes(asStr(unknowns.verdict)))issue(issues,"CONTENT_UNKNOWN_AUDIT_INVALID","validation/unresolved-unknowns.json#/verdict","explicit passing audit required");const unknownClaims=new Set([...claims].filter(([,c])=>c.provenanceClass==="UNKNOWN").map(([id])=>id));for(const [nodeId,s] of settlements)for(const b of asArr(s.branches).map(asRec).filter((x):x is Rec=>Boolean(x)))for(const id of strArr(b.frozenFactIds))if(unknownClaims.has(id))issue(issues,"CONTENT_UNKNOWN_PROMOTED",`nodes/${nodeId}/settlement.json#/${asStr(b.branchId)}`,`UNKNOWN ${id} frozen as fact`);
  const finale=req(parsed,"finale/ending-rules.json",issues);if(asStr(finale.sourceSha256).toUpperCase()!==sourceSha)issue(issues,"CONTENT_SOURCE_SHA_MISMATCH","finale/ending-rules.json#/sourceSha256","mismatch");const tracks=strArr(finale.worldTracks);const finaleSeats=new Set(asArr(finale.seatVerdicts).map(asRec).map(x=>asStr(x?.seatId)).filter(Boolean));if(!tracks.length||!same(finaleSeats,seatIds))issue(issues,"CONTENT_FINALE_INPUT_INVALID","finale/ending-rules.json","world tracks and exactly one verdict per seat required");

  issues.sort((a,b)=>`${a.path}\0${a.code}`.localeCompare(`${b.path}\0${b.code}`));
  return { verdict: issues.length?"FAIL":"PASS", issues, sourceSha256:sourceSha||null, packageId:packageId||null, packageVersion:packageVersion||null, counts:{fileCount:files.size,nodeCount:nodeIds.length,seatCount:seatIds.size,actorCount:actors.size,objectCount:objectIds.size,claimCount:claims.size,adaptationCount:adaptations.size,sceneCount:scenes.size,handoffCount:handoffs.size,branchCount:branchIds.size,frozenResultCount:frozenIds.size,openingProjectionCount:openingIds.size,objectVersionCount:versionIds.size,dialogueSeedCount:dialogueIds.size,stableIdCount:stableIds.size} };
}

export function assertPressureSpinePackage(files: PressureSpineFileMap, options: PressureSpineValidationOptions = {}): PressureSpineValidationReport {
  const report=validatePressureSpinePackage(files,options);const first=report.issues[0];if(first)throw new PressureSpineValidationError(first.code,first.path,first.message,{issueCount:report.issues.length});return report;
}
export function assertPressureSpineSchemaProfile(files: PressureSpineFileMap): void {
  const bytes=files.get("manifest.json");if(!bytes)throw new PressureSpineValidationError("CONTENT_SCHEMA_PROFILE_MISMATCH","manifest.json","manifest missing");let m:Rec;try{m=JSON.parse(decode(bytes,"manifest.json")) as Rec;}catch{throw new PressureSpineValidationError("CONTENT_SCHEMA_PROFILE_MISMATCH","manifest.json","invalid manifest");}if(!asStr(m.schemaVersion).includes("content_manifest")||!Array.isArray(m.nodes)||!Array.isArray(m.seatIds))throw new PressureSpineValidationError("CONTENT_SCHEMA_PROFILE_MISMATCH","manifest.json#/schemaVersion","legacy schema rejected");
}
export const pressureSpineInternal={asRec,asArr,asStr,strArr,decode};
