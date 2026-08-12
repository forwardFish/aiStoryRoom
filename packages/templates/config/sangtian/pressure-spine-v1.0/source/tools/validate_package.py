#!/usr/bin/env python3
from __future__ import annotations
import json, hashlib, re, sys
from pathlib import Path
try:
    import regex as regex_mod
except Exception as exc:
    print(json.dumps({"verdict":"FAIL","errors":["MISSING_REGEX_MODULE:"+str(exc)]},ensure_ascii=False,indent=2));sys.exit(1)
ROOT=Path(__file__).resolve().parents[1]
SOURCE_SHA="04D5E8D4533D86890A79058C25252D33E001668921A2BBD8FFDE401CDD2B6238"
NODES=["P0","N1","N2","N3","N4","N5","N6","N7"]
NODE_INDEX={n:i for i,n in enumerate(NODES)}
SEATS={"seat.zhejiang_governor","seat.zhejiang_administration","seat.qingliu_law","seat.jiangnan_merchant","seat.sili_weaving","seat.cabinet_finance"}
REQ_ROOT=["README.md","manifest.json","inventory.json"]
REQ_GLOBAL=["pressure-spine.json","historical-boundaries.md","seats.json","actors.json","objects.json","knowledge-and-handoffs.json","world-tracks.json","narrative-style.md"]
REQ_NODE=["overview.md","node.json","scene-flow.json","seat-content.json","npc-defaults.json","settlement.json","source-evidence.jsonl","transitions.md","adaptations.json"]
REQ_FINALE=["ending-rules.json","world-ending-scenes.md","seat-verdict-scenes.md","replay-hooks.json"]
REQ_VALID=["coverage-report.json","source-ref-audit.json","continuity-audit.json","knowledge-boundary-audit.json","unresolved-unknowns.json","source-index-reference-map.json"]
BAD=["待补","同上","TODO","TBD","PLACEHOLDER"]
VISIBLE_BAD=[r"\bN[0-7]\b",r"FINALE",r"COMMIT",r"PREPARE",r"REACTION",r"Narrator",r"系统按",r"系统判定",r"玩家选择",r"下一回合",r"本回合"]
GENERIC_KNOWLEDGE=["本席位实际持有的资源和已送达材料","其他席位没有公开或实际送达的私密计划","其他席位未送达的密令、账册和真实承诺"]
errors=[]
def err(x): errors.append(x)
def loadj(p):
    try:return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:err(f"JSON_PARSE:{p.relative_to(ROOT)}:{e}");return None
def loadjl(p):
    out=[]
    try:
        for i,line in enumerate(p.read_text(encoding="utf-8").splitlines(),1):
            if line.strip():out.append(json.loads(line))
    except Exception as e:err(f"JSONL_PARSE:{p.relative_to(ROOT)}:{i}:{e}")
    return out
def compare_value(actual,op,expected):
    if op==">=":return actual>=expected
    if op=="<=":return actual<=expected
    if op==">":return actual>expected
    if op=="<":return actual<expected
    if op=="==":return actual==expected
    if op=="IN":return actual in expected
    raise ValueError("UNSUPPORTED_SELECTOR_OP:"+str(op))
def eval_selector(rule,state):
    if "all" in rule:return all(eval_selector(x,state) for x in rule["all"])
    if "any" in rule:return any(eval_selector(x,state) for x in rule["any"])
    if rule.get("otherwise") is True:return True
    if "expr" in rule:
        expr=str(rule["expr"])
        if not (expr.startswith("min(") and expr.endswith(")")):raise ValueError("UNSUPPORTED_SELECTOR_EXPR:"+expr)
        keys=[x.strip() for x in expr[4:-1].split(",")]
        actual=min(state[x] for x in keys)
    else:actual=state[rule["key"]]
    return compare_value(actual,rule["op"],rule["value"])
def selected_branch_id(settlement,state):
    selector=settlement["branchSelector"]
    for level in selector["evaluationOrder"]:
        if eval_selector(selector["selectors"][level],state):
            branch=next((b for b in settlement.get("branches",[]) if b.get("level")==level),None)
            return branch.get("branchId") if branch else None
    return None
for x in REQ_ROOT:
    if not (ROOT/x).is_file():err("MISSING:"+x)
for x in REQ_GLOBAL:
    if not (ROOT/"global"/x).is_file():err("MISSING:global/"+x)
for n in NODES:
    for x in REQ_NODE:
        if not (ROOT/"nodes"/n/x).is_file():err(f"MISSING:nodes/{n}/{x}")
for x in REQ_FINALE:
    if not (ROOT/"finale"/x).is_file():err("MISSING:finale/"+x)
for x in REQ_VALID:
    if not (ROOT/"validation"/x).is_file():err("MISSING:validation/"+x)
for p in ROOT.rglob("*.json"):loadj(p)
for p in ROOT.rglob("*.jsonl"):loadjl(p)
for p in ROOT.rglob("*"):
    if not p.is_file() or "tools" in p.parts or p.name=="inventory.json":continue
    if p.suffix.lower() not in {".md",".json",".jsonl"}:continue
    text=p.read_text(encoding="utf-8")
    for word in BAD:
        if word in text:err(f"PLACEHOLDER:{p.relative_to(ROOT)}:{word}")
manifest=loadj(ROOT/"manifest.json") or {}
if manifest.get("sourceSha256")!=SOURCE_SHA:err("MANIFEST_SOURCE_SHA")
if set(manifest.get("nodes",[]))!=set(NODES):err("MANIFEST_NODE_COVERAGE")
seats_doc=loadj(ROOT/"global/seats.json") or {}
if {x.get("seatId") for x in seats_doc.get("seats",[])}!=SEATS:err("SEAT_SET")
objects_doc=loadj(ROOT/"global/objects.json") or {}; OBJECTS={x.get("objectId") for x in objects_doc.get("objects",[])}
actors_doc=loadj(ROOT/"global/actors.json") or {}; ACTORS={x.get("actorId"):x for x in actors_doc.get("actors",[])}
handoffs_doc=loadj(ROOT/"global/knowledge-and-handoffs.json") or {}; HANDOFFS={x.get("handoffId"):x for x in handoffs_doc.get("handoffs",[])}
refmap=loadj(ROOT/"validation/source-index-reference-map.json") or {}; paras=refmap.get("paragraphs",{})
claims={}; source_ids=set(); adaptation_ids=set(); scene_map={}; flows={}; settlements={}; dialogue=[]; known_ref_ids=set(); unknown_ref_ids=set()
for n in NODES:
    for c in loadjl(ROOT/f"nodes/{n}/source-evidence.jsonl"):
        cid=c.get("claimId")
        if not cid or cid in source_ids:err(f"CLAIM_ID_DUP:{cid}")
        source_ids.add(cid);claims[cid]=c
        pc=c.get("provenanceClass")
        if pc=="SOURCE_FACT":
            refs=c.get("sourceRefs")
            if not refs:err(f"SOURCE_REF_MISSING:{cid}")
            for r in refs or []:
                if r.get("sourceSha256")!=SOURCE_SHA:err(f"SOURCE_SHA:{cid}")
                if not (1<=int(r.get("lineStart",0))<=int(r.get("lineEnd",0))<=30547):err(f"LINE_RANGE:{cid}")
                ps=r.get("paragraphStartId");pe=r.get("paragraphEndId")
                if not re.match(r"^DM1566-(PROLOGUE|C\d{2})-P\d{4}$",str(ps)):err(f"PARA_FORMAT:{cid}:{ps}")
                if not re.match(r"^DM1566-(PROLOGUE|C\d{2})-P\d{4}$",str(pe)):err(f"PARA_FORMAT:{cid}:{pe}")
                if ps not in paras or pe not in paras:err(f"PARA_UNKNOWN:{cid}")
                else:
                    if paras[ps]["sectionId"]!=r.get("chapterId") or paras[pe]["sectionId"]!=r.get("chapterId"):err(f"PARA_CHAPTER:{cid}")
                    if r["lineStart"]<paras[ps]["lineStart"] or r["lineEnd"]>paras[pe]["lineEnd"]:err(f"PARA_LINES:{cid}")
        elif pc=="INFERENCE":
            if not c.get("supportClaimIds") or c.get("certainty") not in {"strong","medium","weak"}:err(f"INFERENCE_FIELDS:{cid}")
        elif pc=="UNKNOWN":
            if c.get("narratorRule")!="FORBIDDEN_AS_FACT":err(f"UNKNOWN_NARRATOR:{cid}")
        else:err(f"PROVENANCE_CLASS:{cid}:{pc}")
    ad=loadj(ROOT/f"nodes/{n}/adaptations.json") or {}
    for a in ad.get("adaptations",[]):
        aid=a.get("adaptationDecisionId")
        if not aid or aid in adaptation_ids:err(f"ADAPT_ID_DUP:{aid}")
        adaptation_ids.add(aid)
    flow=loadj(ROOT/f"nodes/{n}/scene-flow.json") or {};flows[n]=flow
    for s in flow.get("scenes",[]):
        sid=s.get("sceneId")
        if not sid or sid in scene_map:err(f"SCENE_ID_DUP:{sid}")
        scene_map[sid]=s
        for fld in ["predecessorIds","successorIds","knownBy","applicableObjectIds"]:
            if not isinstance(s.get(fld),list):err(f"SCENE_FIELD:{n}:{sid}:{fld}")
        if s.get("visibility")=="PUBLIC":
            if set(s.get("knownBy",[]))!=SEATS:err(f"PUBLIC_KNOWNBY:{sid}")
            for cid in s.get("sourceClaimIds",[]):
                c=claims.get(cid)
                if not c:err(f"SCENE_CLAIM_UNKNOWN:{sid}:{cid}")
                elif c.get("visibility")!="PUBLIC" or set(c.get("knownBy",[]))!=SEATS:err(f"PUBLIC_LIMITED_CLAIM_LEAK:{sid}:{cid}")
        visible=(str(s.get("title",''))+" "+str(s.get("text",'')))
        for pat in VISIBLE_BAD:
            if re.search(pat,visible,re.I):err(f"VISIBLE_SYSTEM_TERM:{sid}:{pat}")
        if "三封急报" in visible or "近百艘粮船" in visible:err(f"UNSUPPORTED_EXACT_QUANTITY:{sid}")
    seatdoc=loadj(ROOT/f"nodes/{n}/seat-content.json") or {}; entries=seatdoc.get("seats",[])
    if len(entries)!=6 or {x.get("seatId") for x in entries}!=SEATS:err(f"SEAT_COVERAGE:{n}")
    for e in entries:
        seat=e.get("seatId");actor=e.get("currentActorId")
        if actor not in ACTORS or ACTORS[actor].get("seatId")!=seat:err(f"CURRENT_ACTOR_SEAT:{n}:{seat}:{actor}")
        a=ACTORS.get(actor,{})
        if NODE_INDEX[n]<NODE_INDEX.get(a.get("activeFrom"),0) or (a.get("activeUntil") in NODE_INDEX and NODE_INDEX[n]>NODE_INDEX[a.get("activeUntil")]):err(f"CURRENT_ACTOR_ACTIVE_RANGE:{n}:{seat}:{actor}")
        if any(x in e.get("privateOpening","") for x in ["沉默","休息","闲聊","消耗时间","让其他席位先"]):err(f"PRIVATE_OPENING_RULE_TAIL:{n}:{seat}")
        seeds=e.get("dialogueSeeds",[])
        if len(seeds)!=3:err(f"DIALOGUE_SEED_COUNT:{n}:{seat}:{len(seeds)}")
        for d in seeds:
            if not d.get("dialogueSeedId") or not d.get("text"):err(f"DIALOGUE_FIELDS:{n}:{seat}")
            dialogue.append((d.get("text"),n,seat,bool(d.get("signatureLine"))))
        known=e.get("knownFacts",[]);unknown=e.get("unknownFacts",[])
        if e.get("knownFactIds")!=[x.get("factRefId") for x in known]:err(f"KNOWN_ID_LIST:{n}:{seat}")
        if e.get("unknownFactIds")!=[x.get("factRefId") for x in unknown]:err(f"UNKNOWN_ID_LIST:{n}:{seat}")
        for f in known:
            fid=f.get("factRefId")
            if not fid or fid in known_ref_ids:err(f"KNOWN_REF_DUP:{fid}")
            known_ref_ids.add(fid)
            if f.get("currentActorId")!=actor:err(f"KNOWN_ACTOR:{fid}")
            if any(x in f.get("statement","") for x in GENERIC_KNOWLEDGE):err(f"GENERIC_KNOWN:{fid}")
            kind=f.get("sourceKind")
            if kind=="CLAIM":
                c=claims.get(f.get("claimId"))
                if not c:err(f"KNOWN_CLAIM_UNKNOWN:{fid}")
                else:
                    if c.get("visibility")!="PUBLIC" and seat not in c.get("knownBy",[]):err(f"KNOWN_CLAIM_UNAUTHORIZED:{fid}")
                    if NODE_INDEX[c.get("availableFrom")] > NODE_INDEX[n]:err(f"KNOWN_CLAIM_TOO_EARLY:{fid}")
                    if c.get("availableAtPhase") not in {"OPENING_PUBLIC","OPENING_PRIVATE"}:err(f"KNOWN_CLAIM_WRONG_PHASE:{fid}:{c.get('availableAtPhase')}")
            elif kind=="OBJECT_STATE":
                if f.get("objectId") not in OBJECTS:err(f"KNOWN_OBJECT_UNKNOWN:{fid}")
                if f.get("accessVia") not in {"SEAT_AUTHORITY_OR_ACTUAL_CUSTODY","PUBLIC","HANDOFF","TRANSFERRED_AND_RECEIVED"}:err(f"KNOWN_OBJECT_ACCESS:{fid}")
            elif kind=="HANDOFF":
                h=HANDOFFS.get(f.get("handoffId"))
                if not h or h.get("seatId")!=seat:err(f"KNOWN_HANDOFF:{fid}")
                elif NODE_INDEX[n]<=NODE_INDEX[h.get("afterNode")]:err(f"KNOWN_HANDOFF_TOO_EARLY:{fid}")
            elif kind!="NODE_PRESSURE":err(f"KNOWN_KIND:{fid}:{kind}")
        for f in unknown:
            fid=f.get("factRefId")
            if not fid or fid in unknown_ref_ids:err(f"UNKNOWN_REF_DUP:{fid}")
            unknown_ref_ids.add(fid)
            if f.get("currentActorId")!=actor:err(f"UNKNOWN_ACTOR:{fid}")
            if any(x in f.get("statement","") for x in GENERIC_KNOWLEDGE):err(f"GENERIC_UNKNOWN:{fid}")
            if f.get("sourceKind")=="CLAIM":
                c=claims.get(f.get("claimId"))
                if not c:err(f"UNKNOWN_CLAIM_UNKNOWN:{fid}")
                elif c.get("visibility")=="PUBLIC" or seat in c.get("knownBy",[]):
                    if c.get("provenanceClass")!="UNKNOWN":err(f"UNKNOWN_CLAIM_ALREADY_KNOWN:{fid}")
    defaults=loadj(ROOT/f"nodes/{n}/npc-defaults.json") or {}
    classes={x.get("inputClass") for x in defaults.get("inputFallbackPolicies",[])}
    required={"NORMAL_NO_SUBMISSION","SILENCE","SMALL_TALK","REST_DELAY","FABRICATED_SUCCESS","OVERREACH","INSUFFICIENT_RESOURCE","TIMEOUT"}
    if classes!=required:err(f"DEFAULT_CLASSES:{n}:{classes}")
    st=loadj(ROOT/f"nodes/{n}/settlement.json") or {};settlements[n]=st
    if n!="P0":
        if st.get("balanceSeedStatus")!="UNVALIDATED_BALANCE_SEED":err(f"BALANCE_SEED_STATUS:{n}")
        if not st.get("branchSelector") or not st.get("selectorInputs"):err(f"BRANCH_SELECTOR_MISSING:{n}")
        branches=st.get("branches",[])
        if len(branches)!=3:err(f"SETTLEMENT_BRANCHES:{n}")
        default=st.get("defaultTrajectory",{})
        if default.get("defaultBranchId") not in {b.get("branchId") for b in branches}:err(f"DEFAULT_BRANCH:{n}")
        if not default.get("defaultInputState"):err(f"DEFAULT_INPUT_STATE:{n}")
        else:
            try:
                selected=selected_branch_id(st,default.get("defaultInputState"))
                if selected!=default.get("defaultBranchId"):err(f"DEFAULT_BRANCH_NOT_SELECTED:{n}:{selected}:{default.get('defaultBranchId')}")
            except Exception as exc:err(f"DEFAULT_SELECTOR_EVAL:{n}:{exc}")
        for b in branches:
            if not b.get("branchSelector") or b.get("balanceSeedStatus")!="UNVALIDATED_BALANCE_SEED":err(f"BRANCH_RULE:{n}:{b.get('branchId')}")
            if not b.get("frozenResultId") or not b.get("frozenFactIds"):err(f"FROZEN_RESULT:{n}:{b.get('branchId')}")
            if not b.get("objectOutcomes"):err(f"OBJECT_OUTCOMES:{n}:{b.get('branchId')}")
            for o in b.get("objectOutcomes",[]):
                if o.get("objectId") not in OBJECTS or not o.get("versionId") or not o.get("custodyMode") or not o.get("custodyRule"):err(f"OBJECT_OUTCOME_FIELDS:{n}:{b.get('branchId')}")
                if not set(o.get("knownBy",[])).issubset(SEATS):err(f"OBJECT_OUTCOME_KNOWNBY:{n}:{o.get('objectId')}")
        if not any("刚取得" in x and "不得" in x and "销毁" in x for x in st.get("hardRules",[])):err(f"NO_DESTROY_RULE:{n}")
    flows[n]=flow
# A: bidirectional graph closure
for sid,s in scene_map.items():
    for target in s.get("successorIds",[]):
        if target in scene_map and sid not in scene_map[target].get("predecessorIds",[]):err(f"EDGE_NOT_RECIPROCAL_SUCC:{sid}:{target}")
    for pred in s.get("predecessorIds",[]):
        if pred in scene_map and sid not in scene_map[pred].get("successorIds",[]):err(f"EDGE_NOT_RECIPROCAL_PRED:{pred}:{sid}")
# Reachability from P0 opening
reachable=set();stack=["scene.p0.opening.public"]
while stack:
    cur=stack.pop()
    if cur in reachable or cur not in scene_map:continue
    reachable.add(cur);stack.extend(scene_map[cur].get("successorIds",[]))
if len(reachable)!=len(scene_map):err(f"SCENE_UNREACHABLE:{sorted(set(scene_map)-reachable)}")
# Conditional reaction path and no-reaction path
for n in ["N2","N4","N7"]:
    commit=scene_map[f"scene.{n.lower()}.commit_confrontation"]; reaction=scene_map[f"scene.{n.lower()}.reaction"]
    results=[f"scene.{n.lower()}.settlement.{x}" for x in ["high","mid","low"]]
    if reaction["sceneId"] not in commit.get("successorIds",[]):err(f"REACTION_ROUTE_MISSING:{n}")
    if not all(x in commit.get("successorIds",[]) for x in results):err(f"NO_REACTION_ROUTE_MISSING:{n}")
    if not all(x in reaction.get("successorIds",[]) for x in results):err(f"REACTION_TO_SETTLEMENT_MISSING:{n}")
    for x in results:
        if not {commit['sceneId'],reaction['sceneId']}.issubset(set(scene_map[x].get('predecessorIds',[]))):err(f"SETTLEMENT_REACTION_PREDECESSOR:{n}:{x}")
# C: all predecessor branches have verified opening projections with exact frozen/object refs
for n in ["N2","N3","N4","N5","N6","N7"]:
    opening=next(s for s in flows[n]["scenes"] if s.get("sceneType")=="OPENING")
    variants=opening.get("openingProjectionVariants",[])
    prev=NODES[NODE_INDEX[n]-1]; branches=settlements[prev].get("branches",[])
    if len(variants)!=3:err(f"OPENING_VARIANT_COUNT:{n}:{len(variants)}")
    by_result={v.get("predecessorFrozenResultId"):v for v in variants}
    for b in branches:
        v=by_result.get(b.get("frozenResultId"))
        if not v:err(f"OPENING_VARIANT_MISSING:{n}:{b.get('frozenResultId')}");continue
        if v.get("predecessorBranchId")!=b.get("branchId"):err(f"OPENING_BRANCH_PROVENANCE:{n}:{v.get('openingProjectionId')}")
        if not set(v.get("requiredFrozenFactIds",[])).issubset(set(b.get("frozenFactIds",[]))):err(f"OPENING_FACT_PROVENANCE:{n}:{v.get('openingProjectionId')}")
        versions={o.get("versionId") for o in b.get("objectOutcomes",[])}
        if set(v.get("requiredObjectVersionIds",[]))!=versions:err(f"OPENING_OBJECT_PROVENANCE:{n}:{v.get('openingProjectionId')}")
        for proj in v.get("seatPrivateProjections",[]):
            if proj.get("seatId") not in SEATS:err(f"OPENING_SEAT:{n}")
            if not set(proj.get("grantedObjectVersionIds",[])).issubset(versions):err(f"OPENING_PRIVATE_OBJECT:{n}:{proj.get('seatId')}")
# B: explicit N6 public/private secrecy lock, including runtime object worksets.
n6_open=scene_map["scene.n6.opening.public"]
for phrase in ["省府掌握本地四箱","织造局另握内廷四箱","内廷四箱","双方都知道"]:
    if phrase in n6_open.get("text",""):err("N6_PUBLIC_LEAK:"+phrase)
if {"obj.local_four_boxes","obj.inner_court_four_boxes"}&set(n6_open.get("applicableObjectIds",[])):err("N6_PUBLIC_OBJECT_METADATA_LEAK")
n6_expected={
    "seat.zhejiang_governor":{"obj.shen_yishi_person_and_assets"},
    "seat.zhejiang_administration":{"obj.shen_yishi_person_and_assets","obj.local_four_boxes"},
    "seat.qingliu_law":{"obj.shen_yishi_person_and_assets"},
    "seat.jiangnan_merchant":{"obj.shen_yishi_person_and_assets","obj.local_four_boxes"},
    "seat.sili_weaving":{"obj.shen_yishi_person_and_assets","obj.local_four_boxes","obj.inner_court_four_boxes"},
    "seat.cabinet_finance":{"obj.shen_yishi_person_and_assets"}
}
for seat,expected in n6_expected.items():
    private=scene_map["scene.n6.opening.private."+seat.split(".",1)[1]]
    if set(private.get("applicableObjectIds",[]))!=expected:err("N6_PRIVATE_OBJECT_BOUNDARY:"+seat)
# E: dialogue uniqueness and private opening rule separation
texts=[x[0] for x in dialogue]
if len(texts)!=144:err(f"DIALOGUE_TOTAL:{len(texts)}")
if len(set(texts))!=144:err(f"DIALOGUE_UNIQUE:{len(set(texts))}")
from collections import defaultdict
places=defaultdict(list)
for text,n,seat,sig in dialogue:places[text].append((n,seat,sig))
for text,items in places.items():
    if len({x[1] for x in items})>1:err("DIALOGUE_CROSS_SEAT_DUP:"+text)
    if len({x[0] for x in items})>1 and not all(x[2] for x in items):err("DIALOGUE_CROSS_NODE_DUP:"+text)
# H: authored Han statistics
scope=[]
for rel in ["README.md","global","nodes","finale"]:
    p=ROOT/rel
    if p.is_file():scope.append(p)
    else:scope.extend(x for x in p.rglob("*") if x.is_file() and x.suffix.lower() in {".md",".json",".jsonl"})
han=sum(len(regex_mod.findall(r"\p{Script=Han}",p.read_text(encoding="utf-8"))) for p in scope)
coverage=loadj(ROOT/"validation/coverage-report.json") or {}
if coverage.get("totals",{}).get("authoredHanCharacters")!=han:err(f"COVERAGE_HAN:{coverage.get('totals',{}).get('authoredHanCharacters')}:{han}")
if manifest.get("counts",{}).get("authoredHanCharacters")!=han:err(f"MANIFEST_HAN:{manifest.get('counts',{}).get('authoredHanCharacters')}:{han}")
if coverage.get("totals",{}).get("dialogueSeedCount")!=144 or coverage.get("totals",{}).get("uniqueDialogueSeedCount")!=144:err("COVERAGE_DIALOGUE_STATS")
# Inventory verification; canonical self hash zeroes own sha field.
inv=loadj(ROOT/"inventory.json") or {};records={r.get("path"):r for r in inv.get("files",[])};actual={p.relative_to(ROOT).as_posix():p for p in ROOT.rglob("*") if p.is_file()}
if set(records)!=set(actual):err(f"INVENTORY_FILE_SET:{len(records)}:{len(actual)}")
for rel,p in actual.items():
    rec=records.get(rel)
    if not rec:continue
    b=p.read_bytes()
    if rec.get("byteSize")!=len(b):err(f"INVENTORY_SIZE:{rel}")
    if rel=="inventory.json":
        canonical=json.loads(p.read_text(encoding="utf-8"));self_rec=next((x for x in canonical.get("files",[]) if x.get("path")=="inventory.json"),None)
        if not self_rec:err("INVENTORY_SELF_MISSING")
        else:
            stored=self_rec.get("sha256");self_rec["sha256"]="0"*64
            encoded=(json.dumps(canonical,ensure_ascii=False,indent=2)+"\n").encode("utf-8")
            if stored!=hashlib.sha256(encoded).hexdigest().upper():err("INVENTORY_SELF_HASH")
    else:
        if rec.get("sha256")!=hashlib.sha256(b).hexdigest().upper():err(f"INVENTORY_MISMATCH:{rel}")
if errors:
    print(json.dumps({"verdict":"FAIL","errorCount":len(errors),"errors":errors[:300]},ensure_ascii=False,indent=2));sys.exit(1)
print(json.dumps({"verdict":"PASS","nodeCount":8,"seatCount":6,"sceneCount":len(scene_map),"reachableSceneCount":len(reachable),"sourceFactCount":sum(c.get('provenanceClass')=='SOURCE_FACT' for c in claims.values()),"adaptationCount":len(adaptation_ids),"inferenceCount":sum(c.get('provenanceClass')=='INFERENCE' for c in claims.values()),"unknownCount":sum(c.get('provenanceClass')=='UNKNOWN' for c in claims.values()),"dialogueSeedCount":len(texts),"uniqueDialogueSeedCount":len(set(texts)),"openingProjectionVariantCount":sum(len(next(s for s in flows[n]['scenes'] if s.get('sceneType')=='OPENING').get('openingProjectionVariants',[])) for n in NODES),"authoredHanCharacters":han,"inventoryFiles":len(records)},ensure_ascii=False,indent=2))
