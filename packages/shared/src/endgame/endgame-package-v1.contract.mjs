import {createHash} from"node:crypto";
export const NUMERIC_EXPRESSION_OPERATORS=Object.freeze(["metric","state","constant","add","subtract","multiply","divide","average","min","max","invert","clamp","tagCount","factCount"]);
export const BOOLEAN_EXPRESSION_OPERATORS=Object.freeze(["all","any","not","gt","gte","lt","lte","eq","neq","in","factExists","axisOutcomeIs"]);
export const DELAYED_EVENT_STATUSES=Object.freeze(["PENDING","OCCURRED","RESOLVED","CANCELLED","EXPIRED"]);
const NUM=new Set(NUMERIC_EXPRESSION_OPERATORS),BOOL=new Set(BOOLEAN_EXPRESSION_OPERATORS),STAT=new Set(DELAYED_EVENT_STATUSES),ID=/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,SEM=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u,FORBID=new Set(["eval","function","javascript","random","network","file","environment","TRIGGERED"]),MAX_DEPTH=20,MAX_NODES=500;
export class EndgamePackageValidationError extends Error{constructor(issues){super(issues.join("\n"));this.name="EndgamePackageValidationError";this.issues=issues}}
const rec=v=>v&&typeof v==="object"&&!Array.isArray(v),arr=v=>Array.isArray(v),uniq=a=>new Set(a).size===a.length,keys=(o,a,p,e)=>{for(const k of Object.keys(o||{}))if(!a.includes(k))e.push(`${p}: unknown key ${k}`)},need=(o,a,p,e)=>{for(const k of a)if(!(k in o))e.push(`${p}: missing ${k}`)},finite=(v,p,e)=>{if(typeof v!=="number"||!Number.isFinite(v))e.push(`${p}: finite number required`)},sid=(v,p,e)=>{if(typeof v!=="string"||!ID.test(v))e.push(`${p}: invalid id`)},clone=v=>JSON.parse(JSON.stringify(v));
export function validateEndgamePackageV1(v){const e=[];if(!rec(v))return{ok:false,issues:["$: object required"]};const top=["schemaVersion","policyId","policyVersion","worldId","profileId","scope","stateVariables","completion","metrics","derivedMetrics","outcomeAxes","combinationOverrides","factTaxonomy","detailCompilation","narrative","validation","presentation","replay"];keys(v,top,"$",e);need(v,top,"$",e);if(v.schemaVersion!=="endgame_package_v1")e.push("$: invalid schemaVersion");for(const k of["policyId","worldId","profileId"])sid(v[k],`$.${k}`,e);if(!SEM.test(v.policyVersion||""))e.push("$.policyVersion: SemVer required");if(!["PART","STORY"].includes(v.scope))e.push("$.scope: invalid");if("packageHash"in v)e.push("$: packageHash must not be embedded");const states=new Map,metrics=new Map,derived=new Map,axes=new Map,slots=new Set,slotKinds=new Map,profiles=new Set,tags=new Set(v.factTaxonomy?.recommendedTags||[]);
 if(!arr(v.stateVariables)||!v.stateVariables.length)e.push("$.stateVariables: non-empty array required");else for(const[x,s]of v.stateVariables.entries()){need(s,["stateId","type"],`state[${x}]`,e);sid(s.stateId,`state[${x}]`,e);if(states.has(s.stateId))e.push(`duplicate state ${s.stateId}`);if(!["NUMBER","STRING","BOOLEAN"].includes(s.type))e.push(`state ${s.stateId}: invalid type`);states.set(s.stateId,s.type)}
 if(!arr(v.metrics)||v.metrics.length<2||v.metrics.length>8)e.push("$.metrics: 2..8 required");else for(const[x,m]of v.metrics.entries()){sid(m.metricId,`metric[${x}]`,e);if(metrics.has(m.metricId))e.push(`duplicate metric ${m.metricId}`);finite(m.min,"metric.min",e);finite(m.max,"metric.max",e);finite(m.initialValue,"metric.initialValue",e);if(!(m.min<m.max)||m.initialValue<m.min||m.initialValue>m.max)e.push(`metric ${m.metricId}: range invalid`);metrics.set(m.metricId,m)}
 for(const d of v.derivedMetrics||[]){sid(d.derivedMetricId,"derivedMetricId",e);if(metrics.has(d.derivedMetricId)||derived.has(d.derivedMetricId))e.push(`duplicate derived metric ${d.derivedMetricId}`);derived.set(d.derivedMetricId,d.expression)}
 for(const a of v.outcomeAxes||[]){sid(a.axisId,"axisId",e);if(axes.has(a.axisId))e.push(`duplicate axis ${a.axisId}`);const os=new Set;let fb=0;for(const o of a.outcomes||[]){sid(o.outcomeId,"outcomeId",e);if(os.has(o.outcomeId))e.push(`duplicate outcome ${a.axisId}.${o.outcomeId}`);os.add(o.outcomeId);if(o.fallback===true){fb++;if("when"in o)e.push(`fallback ${a.axisId}.${o.outcomeId} cannot have when`)}else if(!("when"in o))e.push(`outcome ${a.axisId}.${o.outcomeId} requires when`)}if(fb!==1)e.push(`axis ${a.axisId}: exactly one fallback required`);axes.set(a.axisId,os)}
 for(const p of v.detailCompilation?.scoringProfiles||[]){if(profiles.has(p.scoringProfileId))e.push(`duplicate scoring profile ${p.scoringProfileId}`);profiles.add(p.scoringProfileId)}for(const s of v.detailCompilation?.slots||[]){if(slots.has(s.slotId))e.push(`duplicate slot ${s.slotId}`);slots.add(s.slotId);slotKinds.set(s.slotId,s.slotKind);if(!profiles.has(s.scoringProfileId))e.push(`slot ${s.slotId}: unknown scoring profile`);if(s.minItems>s.maxItems)e.push(`slot ${s.slotId}: minItems > maxItems`);if(s.fallback==="USE_TEMPLATE"&&!rec(s.fallbackTemplate))e.push(`slot ${s.slotId}: fallbackTemplate required`);selector(s.selector,`slot ${s.slotId}`,tags,e)}
 const scenes=v.detailCompilation?.sceneArchetypes||[];if(scenes.filter(x=>x.fallback===true).length!==1)e.push("sceneArchetypes: exactly one fallback required");for(const s of scenes){if(s.fallback===true&&"when"in s)e.push(`scene ${s.sceneId}: fallback cannot have when`);if(s.fallback!==true&&!s.when)e.push(`scene ${s.sceneId}: when required`);selector(s.anchorSelector,`scene ${s.sceneId}`,tags,e)}
 const refs={states,metrics,derived,axes,slots,tags};bool(v.completion?.when,"$.completion.when",refs,e);for(const[id,x]of derived)num(x,`derived.${id}`,refs,e);cycles(derived,e);for(const a of v.outcomeAxes||[])for(const o of a.outcomes||[])if(o.when)bool(o.when,`outcome.${a.axisId}.${o.outcomeId}`,refs,e);for(const x of v.combinationOverrides||[])bool(x.when,`combination.${x.combinationId}`,refs,e);for(const x of v.detailCompilation?.styleProfiles||[])bool(x.when,`style.${x.styleId}`,refs,e);for(const x of scenes)if(x.when)bool(x.when,`scene.${x.sceneId}`,refs,e);for(const x of v.replay?.hintTemplates||[])bool(x.when,"replay.when",refs,e);
 validateNarrative(v.narrative,v.scope,{slots,slotKinds,axes,tags},e);
 for(const a of v.presentation?.axisOrder||[])if(!axes.has(a))e.push(`presentation: unknown axis ${a}`);for(const m of v.presentation?.metricOrder||[])if(!metrics.has(m))e.push(`presentation: unknown metric ${m}`);for(const s of v.presentation?.sections||[])for(const id of s.slotIds||[])if(!slots.has(id))e.push(`presentation: unknown slot ${id}`);scan(v,"$",e);return{ok:e.length===0,issues:e}}
export function assertEndgamePackageV1(v){const r=validateEndgamePackageV1(v);if(!r.ok)throw new EndgamePackageValidationError(r.issues);return v}
function validateNarrative(n,scope,refs,e){
 if(!rec(n)){e.push("$.narrative: required");return}
 const required=["language","pointOfView","tone","pacing","length","paragraphPlan","worldImagery","forbiddenPhrases","scopeConstraints","fallback"];
 keys(n,required,"narrative",e);need(n,required,"narrative",e);
 if(typeof n.language!=="string"||!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(n.language))e.push("narrative.language: BCP-47-style tag required");
 if(!["FIRST_PERSON","SECOND_PERSON","THIRD_PERSON_LIMITED","THIRD_PERSON_OMNISCIENT"].includes(n.pointOfView))e.push("narrative.pointOfView: invalid");
 if(!arr(n.tone?.tags)||n.tone.tags.length<1||n.tone.tags.length>8||!uniq(n.tone.tags))e.push("narrative.tone.tags: 1..8 unique tags required");
 if(!["SLOW","MODERATE","FAST","VARIED"].includes(n.pacing?.tempo)||!["SHORT","MIXED","LONG"].includes(n.pacing?.sentenceRhythm)||!["CONTINUOUS","SCENE_CUTS","REFLECTIVE"].includes(n.pacing?.transitionStyle))e.push("narrative.pacing: invalid");
 const length=n.length||{};if(!Number.isInteger(length.minChars)||!Number.isInteger(length.targetChars)||!Number.isInteger(length.maxChars)||length.minChars<80||length.maxChars>5000||!(length.minChars<=length.targetChars&&length.targetChars<=length.maxChars))e.push("narrative.length: 80 <= min <= target <= max <= 5000 required");
 const paragraphs=n.paragraphPlan||[],paragraphIds=new Set;for(const paragraph of paragraphs){if(paragraphIds.has(paragraph.paragraphId))e.push(`narrative: duplicate paragraph ${paragraph.paragraphId}`);paragraphIds.add(paragraph.paragraphId);for(const slot of paragraph.requiredSlots||[])if(!refs.slots.has(slot))e.push(`paragraph ${paragraph.paragraphId}: unknown slot ${slot}`);for(const axis of paragraph.requiredAxes||[])if(!refs.axes.has(axis))e.push(`paragraph ${paragraph.paragraphId}: unknown axis ${axis}`)}
 for(const tag of[...(n.worldImagery?.requiredTags||[]),...(n.worldImagery?.preferredTags||[]),...(n.worldImagery?.forbiddenTags||[])])if(!refs.tags.has(tag))e.push(`narrative imagery: unknown tag ${tag}`);
 if(!arr(n.forbiddenPhrases)||!n.forbiddenPhrases.every(x=>typeof x==="string"&&x.length>0))e.push("narrative.forbiddenPhrases: literal strings required");
 if(n.scopeConstraints?.PART?.allowLifetimeClosure!==false||n.scopeConstraints?.PART?.requireUnresolvedHook!==true)e.push("narrative PART boundary invalid");
 if(n.scopeConstraints?.STORY?.allowLifetimeClosure!==true)e.push("narrative STORY boundary invalid");
 if(scope==="PART"&&!paragraphs.some(p=>(p.appliesTo||[]).includes("PART")&&p.purpose==="UNRESOLVED_HOOK"))e.push("PART requires unresolved paragraph");
 const fallback=n.fallback;if(!rec(fallback)||fallback.mode!=="TEMPLATE_ONLY")e.push("narrative.fallback: TEMPLATE_ONLY required");else{
  const allowed=new Set(fallback.allowedPlaceholders||[]);if(!arr(fallback.allowedPlaceholders)||!uniq(fallback.allowedPlaceholders))e.push("narrative.fallback.allowedPlaceholders: unique array required");
  for(const placeholder of allowed)validatePlaceholder(placeholder,refs,e);
  for(const targetScope of["PART","STORY"]){const templates=fallback.paragraphTemplates?.[targetScope];if(!arr(templates)||!templates.length)e.push(`narrative.fallback.${targetScope}: templates required`);else for(const template of templates){if(typeof template!=="string"||!template.trim())e.push(`narrative.fallback.${targetScope}: non-empty template required`);for(const placeholder of template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/gu))if(!allowed.has(placeholder[1]))e.push(`narrative fallback: placeholder ${placeholder[1]} is not allowed`)}}
 }
}
function validatePlaceholder(value,refs,e){
 if(typeof value!=="string"){e.push("narrative placeholder: string required");return}
 const axis=/^axis\.([A-Za-z0-9][A-Za-z0-9._:-]*)\.(title|summary)$/u.exec(value);if(axis){if(!refs.axes.has(axis[1]))e.push(`narrative placeholder: unknown axis ${axis[1]}`);return}
 const slot=/^([A-Za-z0-9][A-Za-z0-9._:-]*)\.(0|[1-9]\d*)\.(title|text)$/u.exec(value);if(slot){if(!refs.slots.has(slot[1]))e.push(`narrative placeholder: unknown slot ${slot[1]}`);return}
 e.push(`narrative placeholder: unsupported ${value}`);
}
const SOURCE_TYPES=new Set(["PLAYER_ACTION","METRIC_CHANGE","CAUSAL_EVENT","RELATIONSHIP_CHANGE","PROMISE","RESOURCE_CHANGE","RIGHT_CHANGE","DELAYED_EVENT","CANON_FACT"]);
const FACT_CATEGORIES=new Set(["ACTION","ACHIEVEMENT","COST","RELATIONSHIP","OBLIGATION","ASSET","RIGHT","PUBLIC_AFTERMATH","POLITICAL_AFTERMATH","POLICY_AFTERMATH","SCENE_ANCHOR","UNRESOLVED_HOOK","CUSTOM"]);
const POLARITIES=new Set(["POSITIVE","NEGATIVE","MIXED","NEUTRAL"]);
const VISIBILITIES=new Set(["PLAYER","PUBLIC"]);
const SELECTOR_KEYS=["sourceTypes","categories","statuses","polarities","visibility","includeTagsAny","includeTagsAll","excludeTags","minMagnitude"];
function selector(s,p,tags,e){
 if(!rec(s)){e.push(`${p}: selector required`);return}
 keys(s,SELECTOR_KEYS,p,e);
 for(const[name,allowed]of [["sourceTypes",SOURCE_TYPES],["categories",FACT_CATEGORIES],["statuses",STAT],["polarities",POLARITIES],["visibility",VISIBILITIES]]){
  if(s[name]!==undefined&&(!arr(s[name])||!uniq(s[name])))e.push(`${p}.${name}: unique array required`);
  for(const value of s[name]||[])if(!allowed.has(value))e.push(`${p}: invalid ${name} ${value}`);
 }
 for(const name of["includeTagsAny","includeTagsAll","excludeTags"]){
  if(s[name]!==undefined&&(!arr(s[name])||!uniq(s[name])))e.push(`${p}.${name}: unique array required`);
  for(const value of s[name]||[])if(!tags.has(value))e.push(`${p}: unknown tag ${value}`);
 }
 if(s.minMagnitude!==undefined)finite(s.minMagnitude,`${p}.minMagnitude`,e);
}
function visitBudget(b,p,e,depth){b.nodes++;if(b.nodes>MAX_NODES)e.push(`${p}: node limit`);if(depth>MAX_DEPTH)e.push(`${p}: depth limit`)}
function one(o,p,e){if(!rec(o)){e.push(`${p}: expression object required`);return null}const k=Object.keys(o);if(k.length!==1){e.push(`${p}: exactly one operator required`);return null}return k[0]}
function num(x,p,r,e,b={nodes:0},depth=1){
 visitBudget(b,p,e,depth);const op=one(x,p,e);if(!op||!NUM.has(op)){if(op)e.push(`${p}: unknown numeric operator ${op}`);return}
 if(op==="metric"){if(typeof x.metric!=="string"||(!r.metrics.has(x.metric)&&!r.derived.has(x.metric)))e.push(`${p}: unknown metric ${x.metric}`);return}
 if(op==="state"){if(r.states.get(x.state)!=="NUMBER")e.push(`${p}: numeric state required`);return}
 if(op==="constant"){finite(x.constant,p,e);return}
 if(["add","multiply","average","min","max"].includes(op)){
  if(!arr(x[op])||!x[op].length)e.push(`${p}: ${op} requires 1+ args`);else x[op].forEach((z,i)=>num(z,`${p}.${op}[${i}]`,r,e,b,depth+1));return
 }
 if(["subtract","divide"].includes(op)){
  if(!arr(x[op])||x[op].length!==2)e.push(`${p}: ${op} requires 2 args`);else{x[op].forEach((z,i)=>num(z,`${p}.${op}[${i}]`,r,e,b,depth+1));if(op==="divide"&&x[op][1]?.constant===0)e.push(`${p}: division by zero`)}return
 }
 if(["invert","clamp"].includes(op)){
  const z=x[op];if(!rec(z)||Object.keys(z).sort().join()!=["max","min","value"].join())e.push(`${p}: ${op} requires value,min,max`);else{for(const k of["value","min","max"])num(z[k],`${p}.${op}.${k}`,r,e,b,depth+1);if(z.min?.constant>z.max?.constant)e.push(`${p}: min > max`)}return
 }
 if(op==="tagCount"){
  const z=x.tagCount;if(!rec(z)||Object.keys(z).sort().join()!=["selector","tag"].join())e.push(`${p}: tagCount requires selector,tag`);else{selector(z.selector,`${p}.tagCount.selector`,r.tags,e);if(typeof z.tag!=="string"||!r.tags.has(z.tag))e.push(`${p}: unknown tag ${z.tag}`)}return
 }
 selector(x.factCount,`${p}.factCount`,r.tags,e);
}
function jsonScalar(v){return v===null||typeof v==="string"||typeof v==="boolean"||(typeof v==="number"&&Number.isFinite(v))}
function scalar(x,p,r,e,b,depth){const op=one(x,p,e);if(op==="constant"){if(!jsonScalar(x.constant))e.push(`${p}: JSON scalar required`);return}if(op==="state"){if(!r.states.has(x.state))e.push(`${p}: unknown state ${x.state}`);return}num(x,p,r,e,b,depth)}
function bool(x,p,r,e,b={nodes:0},depth=1){
 visitBudget(b,p,e,depth);const op=one(x,p,e);
 if(op==="constant"){if(typeof x.constant!=="boolean")e.push(`${p}: boolean constant required`);return}
 if(op==="state"){if(r.states.get(x.state)!=="BOOLEAN")e.push(`${p}: boolean state required`);return}
 if(!op||!BOOL.has(op)){if(op)e.push(`${p}: unknown boolean operator ${op}`);return}
 if(["all","any"].includes(op)){if(!arr(x[op])||!x[op].length)e.push(`${p}: ${op} requires 1+ args`);else x[op].forEach((z,i)=>bool(z,`${p}.${op}[${i}]`,r,e,b,depth+1));return}
 if(op==="not"){bool(x.not,`${p}.not`,r,e,b,depth+1);return}
 if(["gt","gte","lt","lte"].includes(op)){if(!arr(x[op])||x[op].length!==2)e.push(`${p}: ${op} requires 2 args`);else x[op].forEach((z,i)=>num(z,`${p}.${op}[${i}]`,r,e,b,depth+1));return}
 if(["eq","neq"].includes(op)){if(!arr(x[op])||x[op].length!==2)e.push(`${p}: ${op} requires 2 args`);else x[op].forEach((z,i)=>scalar(z,`${p}.${op}[${i}]`,r,e,b,depth+1));return}
 if(op==="in"){if(!arr(x.in)||x.in.length!==2||!rec(x.in[1])||Object.keys(x.in[1]).join()!=="constant"||!arr(x.in[1].constant)||!x.in[1].constant.length||!x.in[1].constant.every(jsonScalar))e.push(`${p}: in requires [scalar,{constant:non-empty scalar array}]`);else scalar(x.in[0],`${p}.in[0]`,r,e,b,depth+1);return}
 if(op==="factExists"){selector(x.factExists,`${p}.factExists`,r.tags,e);return}
 if(!arr(x.axisOutcomeIs)||x.axisOutcomeIs.length!==2){e.push(`${p}: axisOutcomeIs requires [axisId,outcomeId]`);return}
 const[a,o]=x.axisOutcomeIs;if(!r.axes.get(a)?.has(o))e.push(`${p}: unknown axis outcome ${a}.${o}`);
}
function cycles(d,e){const seen=new Set,done=new Set;function go(id,path){if(seen.has(id)){e.push(`derived metric cycle: ${[...path,id].join(" -> ")}`);return}if(done.has(id))return;seen.add(id);for(const r of metricRefs(d.get(id)))if(d.has(r))go(r,[...path,id]);seen.delete(id);done.add(id)}for(const id of d.keys())go(id,[])}
function metricRefs(x,out=new Set){if(rec(x)){if(typeof x.metric==="string")out.add(x.metric);for(const v of Object.values(x))metricRefs(v,out)}else if(arr(x))x.forEach(v=>metricRefs(v,out));return out}
function scan(x,p,e){if(typeof x==="string"&&FORBID.has(x))e.push(`${p}: forbidden token ${x}`);else if(arr(x))x.forEach((v,i)=>scan(v,`${p}[${i}]`,e));else if(rec(x))for(const[k,v]of Object.entries(x)){if(FORBID.has(k))e.push(`${p}: forbidden key ${k}`);scan(v,`${p}.${k}`,e)}}
function ctx(c){return{metrics:c.metrics||{},state:c.state||{},facts:c.facts||[],axisOutcomes:c.axisOutcomes||{}}}
function evalBudget(b,depth){if(++b.nodes>MAX_NODES||depth>MAX_DEPTH)throw Error("EXPRESSION_LIMIT")}
function facts(f,s){return f.filter(x=>(!s.sourceTypes||s.sourceTypes.includes(x.sourceType))&&(!s.categories||s.categories.includes(x.category))&&(!s.statuses||s.statuses.includes(x.status))&&(!s.polarities||s.polarities.includes(x.polarity))&&(!s.visibility||s.visibility.includes(x.visibility))&&(!s.includeTagsAny||s.includeTagsAny.some(t=>(x.tags||[]).includes(t)))&&(!s.includeTagsAll||s.includeTagsAll.every(t=>(x.tags||[]).includes(t)))&&(!s.excludeTags||s.excludeTags.every(t=>!(x.tags||[]).includes(t)))&&(s.minMagnitude==null||x.magnitude>=s.minMagnitude))}
export function evaluateNumericExpression(x,c={}){return en(x,ctx(c),{nodes:0},1)}
export function evaluateBooleanExpression(x,c={}){return eb(x,ctx(c),{nodes:0},1)}
function en(x,c,b,depth){
 evalBudget(b,depth);const op=Object.keys(x)[0],v=x[op];let z;
 if(op==="metric")z=c.metrics[v];else if(op==="state")z=c.state[v];else if(op==="constant")z=v;else if(op==="tagCount")z=facts(c.facts,v.selector).filter(f=>(f.tags||[]).includes(v.tag)).length;else if(op==="factCount")z=facts(c.facts,v).length;else if(["invert","clamp"].includes(op)){const a=en(v.value,c,b,depth+1),lo=en(v.min,c,b,depth+1),hi=en(v.max,c,b,depth+1);if(lo>hi)throw Error("INVALID_BOUNDARY");z=op==="invert"?lo+hi-a:Math.max(lo,Math.min(hi,a))}else{const a=v.map(y=>en(y,c,b,depth+1));if(op==="add")z=a.reduce((q,w)=>q+w,0);if(op==="subtract")z=a[0]-a[1];if(op==="multiply")z=a.reduce((q,w)=>q*w,1);if(op==="divide"){if(a[1]===0)throw Error("DIVIDE_BY_ZERO");z=a[0]/a[1]}if(op==="average")z=a.reduce((q,w)=>q+w,0)/a.length;if(op==="min")z=Math.min(...a);if(op==="max")z=Math.max(...a)}
 if(typeof z!=="number"||!Number.isFinite(z))throw Error("NON_FINITE_RESULT");return z
}
function es(x,c,b,depth){const op=Object.keys(x)[0];if(op==="state"||op==="constant"){evalBudget(b,depth);return op==="state"?c.state[x.state]:x.constant}return en(x,c,b,depth)}
function eb(x,c,b,depth){
 evalBudget(b,depth);const op=Object.keys(x)[0],v=x[op];if(op==="constant"){if(typeof v!=="boolean")throw Error("BOOLEAN_CONSTANT_REQUIRED");return v}if(op==="state"){if(typeof c.state[v]!=="boolean")throw Error("BOOLEAN_STATE_REQUIRED");return c.state[v]}if(op==="all")return v.every(y=>eb(y,c,b,depth+1));if(op==="any")return v.some(y=>eb(y,c,b,depth+1));if(op==="not")return!eb(v,c,b,depth+1);if(op==="factExists")return facts(c.facts,v).length>0;if(op==="axisOutcomeIs")return c.axisOutcomes[v[0]]===v[1];if(op==="in")return v[1].constant.some(y=>Object.is(y,es(v[0],c,b,depth+1)));const a=es(v[0],c,b,depth+1),d=es(v[1],c,b,depth+1);if(op==="gt")return a>d;if(op==="gte")return a>=d;if(op==="lt")return a<d;if(op==="lte")return a<=d;if(op==="eq")return Object.is(a,d);if(op==="neq")return!Object.is(a,d);throw Error("UNKNOWN_BOOLEAN_OPERATOR")
}
function unicode(s){for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xD800&&c<=0xDBFF){const n=s.charCodeAt(++i);if(!(n>=0xDC00&&n<=0xDFFF))throw Error("INVALID_UNICODE")}else if(c>=0xDC00&&c<=0xDFFF)throw Error("INVALID_UNICODE")}}
export function canonicalizeJcs(v){const stack=new Set;function c(x){if(x===null)return"null";if(typeof x==="string"){unicode(x);return JSON.stringify(x)}if(typeof x==="number"){if(!Number.isFinite(x))throw Error("JCS_NON_FINITE");return JSON.stringify(Object.is(x,-0)?0:x)}if(typeof x==="boolean")return x?"true":"false";if(arr(x)){if(stack.has(x))throw Error("JCS_CYCLE");if(Object.keys(x).length!==x.length)throw Error("JCS_SPARSE_ARRAY");stack.add(x);const r=`[${x.map(c).join(",")}]`;stack.delete(x);return r}if(rec(x)){if(stack.has(x))throw Error("JCS_CYCLE");stack.add(x);const r=`{${Object.keys(x).sort().map(k=>`${c(k)}:${c(x[k])}`).join(",")}}`;stack.delete(x);return r}throw Error("JCS_NON_JSON_VALUE")}return c(v)}
export function computeEndgamePackageHash(v){assertEndgamePackageV1(v);return createHash("sha256").update(Buffer.from(canonicalizeJcs(v),"utf8")).digest("hex")}
function deepFreeze(v){if(!v||typeof v!=="object"||Object.isFrozen(v))return v;for(const child of Object.values(v))deepFreeze(child);return Object.freeze(v)}
export function createEndgamePackageSnapshotV1(v){assertEndgamePackageV1(v);const canonicalPackage=canonicalizeJcs(v),packageDocument=deepFreeze(JSON.parse(canonicalPackage));return Object.freeze({schemaVersion:"endgame_package_snapshot_v1",policyId:v.policyId,policyVersion:v.policyVersion,packageHash:createHash("sha256").update(Buffer.from(canonicalPackage,"utf8")).digest("hex"),canonicalPackage,packageDocument})}
