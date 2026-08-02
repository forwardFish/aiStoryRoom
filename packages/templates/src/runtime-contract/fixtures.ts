import type { WorldRuntimeContract } from "./types";

function fixture(worldId: string, title: string, secondKind: "DOCUMENT" | "EVIDENCE", locale: string): WorldRuntimeContract {
  const actor=`${worldId}.actor.lead`, institution=`${worldId}.institution.council`, item=`${worldId}.${secondKind.toLowerCase()}.item`, secret=`${worldId}.secret.plan`, location=`${worldId}.location.hall`, resource=`${worldId}.resource.influence`;
  const capability=`${worldId}.capability.authorize`, policy=`${worldId}.policy.lead`, projection=`${worldId}.projection.lead`, immediate=`${worldId}.rule.immediate`, delayed=`${worldId}.rule.delayed`;
  const itemPredicate = secondKind === "DOCUMENT" ? {type:"DOCUMENT.CREATED" as const,documentId:item} : {type:"EVIDENCE.DESTROYED" as const,evidenceId:item};
  return {
    worldId,contractVersion:"1.0.0",aliases:[`${worldId}-v1`],title,
    entities:[
      {id:actor,kind:"ACTOR",displayName:"Lead",aliases:[],durable:true,initialStatus:{}},
      {id:institution,kind:"INSTITUTION",displayName:"Council",aliases:[],durable:true,initialStatus:{}},
      {id:item,kind:secondKind,displayName:"Key item",aliases:[],durable:true,initialStatus:{}},
      {id:secret,kind:"SECRET",displayName:"Hidden plan",aliases:[],durable:true,initialStatus:{}},
      {id:location,kind:"LOCATION",displayName:"Hall",aliases:[],durable:true,initialStatus:{}},
      {id:resource,kind:"RESOURCE",displayName:"Influence",aliases:[],durable:true,initialStatus:{amount:1}}
    ],
    roles:[{id:`${worldId}.role.lead`,actorId:actor,goalIds:[`${worldId}.goal.stability`],secretIds:[secret],destinyQuestion:"What choice changes the shared world?",openingProjectionId:projection,policyId:policy}],
    actorPolicies:[{id:policy,actorId:actor,capabilityIds:[capability]}],
    capabilities:[{id:capability,institutionId:institution,allowedActorIds:[actor],effectTemplates:[itemPredicate]}],
    knowledgeAcl:[{id:`${worldId}.acl.plan`,secretId:secret,actorIds:[actor],visibility:{scope:"PRIVATE",actorId:actor}}],
    destinyHooks:[{id:`${worldId}.hook.crisis`,actorIds:[actor],entityIds:[item,institution],secretIds:[secret],causalRuleIds:[immediate,delayed],activationCondition:{all:[{type:"ENTITY.INTRODUCED",entityId:institution}]}}],
    causalRules:[{id:immediate,capabilityId:capability,condition:{all:[{type:"ENTITY.INTRODUCED",entityId:institution}]},effects:[itemPredicate,{type:"RESOURCE.CHANGED",actorId:actor,resourceId:resource,delta:1}],visibility:{scope:"PUBLIC"}}],
    delayedRules:[{id:delayed,capabilityId:capability,condition:{all:[itemPredicate]},effects:[{type:"WORLD.PRESSURE_CHANGED",pressureId:`${worldId}.pressure.crisis`,delta:1}],visibility:{scope:"ACTOR_SET",actorIds:[actor]},delayRevisions:2}],
    styleProfile:{locale,pov:"THIRD_PERSON_LIMITED",tense:"PAST",tags:["political","multi-pov"]},
    openingState:{worldId,revision:0,predicates:[{type:"ENTITY.INTRODUCED",entityId:institution},{type:"ENTITY.LOCATED_AT",entityId:item,locationId:location}],pendingRuleIds:[]},
    openingProjections:[{id:projection,actorId:actor,visibleEntityIds:[actor,institution,item,location,resource],knownSecretIds:[secret],visiblePredicates:[{type:"ENTITY.INTRODUCED",entityId:institution},{type:"ENTITY.LOCATED_AT",entityId:item,locationId:location}]}]
  };
}

export const sangtianRuntimeFixture = fixture("sangtian", "桑田诏", "DOCUMENT", "zh-CN");
export const caesarRuntimeFixture = fixture("caesar", "Caesar", "EVIDENCE", "en");
