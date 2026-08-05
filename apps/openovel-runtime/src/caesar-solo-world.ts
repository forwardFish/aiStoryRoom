import { createScriptedWorldModule, type ScriptedWorldConfig } from "./scripted-world.js";

/**
 * Engineering fixture for proving that the solo pipeline is world-agnostic.
 * It is intentionally small and must not be presented as a production-quality
 * adaptation of the Caesar source material.
 */
export const caesarSoloConfig: ScriptedWorldConfig = {
  worldId: "caesar",
  roleId: "senator",
  title: "Caesar: The Warning",
  packageVersion: "caesar-engineering-v1",
  brief: "A senator must decide how to handle a warning while public duty, private loyalty, and political danger pull in different directions.",
  tone: [
    "Write a continuous political scene with people, place, gesture, and contested motives.",
    "Let each choice visibly change who knows the warning and who bears responsibility.",
    "Do not turn the scene into a report, checklist, or summary of game rules.",
  ],
  opening: {
    prologueNarrative: "At first light, before the Senate gathered, a sealed warning reached the senator's house. The messenger would name no author. Outside, Rome was already filling with clients, petitioners, and men pretending not to watch the door.",
    canon: "The senator received one sealed warning before the Senate assembled. Its author was unknown, and no other person had yet been shown its contents.",
    stepId: "warning_in_hand",
    scene: {
      sceneId: "senator_house_dawn",
      timeLabel: "dawn",
      locationLabel: "the senator's house",
      situation: "The Senate will assemble soon, and the anonymous warning cannot remain private without consequence.",
      presentActors: [
        { actorRef: "caesar.actor.senator", displayName: "the senator" },
        { actorRef: "caesar.actor.messenger", displayName: "the messenger" },
      ],
    },
    keyFacts: {
      warningHolder: "senator",
      warningAuthor: "unknown",
      warningDisclosure: "private",
      senateSession: "not_started",
    },
  },
  steps: [
    {
      stepId: "warning_in_hand",
      options: [
        {
          id: "caesar_open_senate",
          label: "Take the warning into the Senate and demand that it be read before debate begins.",
          intent: "Make the warning public through the Senate.",
          risk: "high",
        },
        {
          id: "caesar_private_consul",
          label: "Show the warning privately to the presiding consul before the chamber fills.",
          intent: "Seek official action without immediately exposing the warning to every senator.",
          risk: "medium",
        },
      ],
    },
    {
      stepId: "warning_contested",
      options: [
        {
          id: "caesar_name_witnesses",
          label: "Ask two senators from opposing factions to witness the warning and its seal.",
          intent: "Create a shared chain of responsibility for the warning.",
          risk: "medium",
        },
        {
          id: "caesar_retain_warning",
          label: "Keep the original warning and give the chamber only your own account of it.",
          intent: "Preserve control of the document while accepting personal responsibility for the claim.",
          risk: "high",
        },
      ],
    },
    {
      stepId: "senate_response",
      options: [
        {
          id: "caesar_suspend_business",
          label: "Move to suspend ordinary business until the warning has been examined.",
          intent: "Put institutional caution ahead of the scheduled debate.",
          risk: "high",
        },
        {
          id: "caesar_continue_under_record",
          label: "Let debate continue, but require the warning and every objection to enter the Senate record.",
          intent: "Preserve public business while making responsibility traceable.",
          risk: "medium",
        },
      ],
    },
  ],
  transitions: [
    {
      optionId: "caesar_open_senate",
      fromStepId: "warning_in_hand",
      toStepId: "warning_contested",
      sourceRef: "caesar.fixture.warning.open-senate",
      settledNarrative: "The senator carried the sealed warning into the chamber and asked that it be read before any other business.",
      immediateReaction: "The consul did not open it at once; he looked first to the benches, where surprise hardened into calculation.",
      worldPressure: "By making the warning public, the senator forced every faction to decide whether acknowledging it served or endangered them.",
      stopCondition: "The consul asks who will stand as witness to the warning and its seal.",
      keyFactUpdates: {
        warningDisclosure: "senate_public",
        senateSession: "opened_under_warning",
      },
      nextScene: {
        sceneId: "senate_chamber_morning",
        timeLabel: "morning",
        locationLabel: "the Senate chamber",
        situation: "The warning is now public, but its credibility and custody are contested.",
        presentActors: [
          { actorRef: "caesar.actor.senator", displayName: "the senator" },
          { actorRef: "caesar.actor.consul", displayName: "the presiding consul" },
          { actorRef: "caesar.actor.senate", displayName: "the assembled senators" },
        ],
      },
    },
    {
      optionId: "caesar_private_consul",
      fromStepId: "warning_in_hand",
      toStepId: "warning_contested",
      sourceRef: "caesar.fixture.warning.private-consul",
      settledNarrative: "Before the chamber filled, the senator placed the sealed warning in the consul's hands and asked him to judge whether it required public action.",
      immediateReaction: "The consul read it alone, then returned it without saying whether he believed the unnamed author.",
      worldPressure: "The warning remained outside the public record, leaving the senator dependent on a consul who could later deny its urgency.",
      stopCondition: "As senators take their seats, the consul asks whether anyone else can attest that the warning existed before the session.",
      keyFactUpdates: {
        warningDisclosure: "consul_private",
        senateSession: "assembling",
      },
      nextScene: {
        sceneId: "senate_chamber_morning",
        timeLabel: "morning",
        locationLabel: "the Senate chamber",
        situation: "The consul has privately read the warning, but the chamber does not yet know why the senator is watching him.",
        presentActors: [
          { actorRef: "caesar.actor.senator", displayName: "the senator" },
          { actorRef: "caesar.actor.consul", displayName: "the presiding consul" },
          { actorRef: "caesar.actor.senate", displayName: "the assembled senators" },
        ],
      },
    },
    {
      optionId: "caesar_name_witnesses",
      fromStepId: "warning_contested",
      toStepId: "senate_response",
      sourceRef: "caesar.fixture.warning.witnesses",
      settledNarrative: "The senator named two men from opposing factions and asked both to witness the warning and its unbroken seal.",
      immediateReaction: "Neither witness could now dismiss the paper without also explaining why he refused to look at it.",
      worldPressure: "Responsibility for the warning widened beyond one senator, but so did the number of men with reason to shape its meaning.",
      stopCondition: "With the witnesses waiting, the chamber must decide whether ordinary business can continue before the warning is examined.",
      keyFactUpdates: {
        warningWitnesses: "two_opposing_senators",
        warningCustody: "witnessed_by_chamber",
      },
      nextScene: {
        sceneId: "senate_chamber_deliberation",
        timeLabel: "later that morning",
        locationLabel: "the Senate chamber",
        situation: "The warning now has witnesses, and the chamber is divided over whether it should interrupt public business.",
        presentActors: [
          { actorRef: "caesar.actor.senator", displayName: "the senator" },
          { actorRef: "caesar.actor.consul", displayName: "the presiding consul" },
          { actorRef: "caesar.actor.senate", displayName: "the assembled senators" },
        ],
      },
    },
    {
      optionId: "caesar_retain_warning",
      fromStepId: "warning_contested",
      toStepId: "senate_response",
      sourceRef: "caesar.fixture.warning.retain-original",
      settledNarrative: "The senator kept the original warning and gave the chamber only his own account of what it said.",
      immediateReaction: "The refusal to surrender the paper made his enemies question his proof and his allies question what he feared losing.",
      worldPressure: "The document remained secure, but the warning now rested on the senator's credibility alone.",
      stopCondition: "The chamber demands a motion: halt its business on his word, or proceed while the disputed warning remains in his custody.",
      keyFactUpdates: {
        warningHolder: "senator",
        warningCustody: "retained_without_witnesses",
      },
      nextScene: {
        sceneId: "senate_chamber_deliberation",
        timeLabel: "later that morning",
        locationLabel: "the Senate chamber",
        situation: "The warning remains with the senator, and the chamber must act without inspecting the original.",
        presentActors: [
          { actorRef: "caesar.actor.senator", displayName: "the senator" },
          { actorRef: "caesar.actor.consul", displayName: "the presiding consul" },
          { actorRef: "caesar.actor.senate", displayName: "the assembled senators" },
        ],
      },
    },
    {
      optionId: "caesar_suspend_business",
      fromStepId: "senate_response",
      toStepId: "complete",
      sourceRef: "caesar.fixture.warning.suspend-business",
      settledNarrative: "The senator moved to suspend ordinary business until the warning could be examined and answered.",
      immediateReaction: "The motion divided the chamber between men who feared delay and men who feared being recorded as having ignored the warning.",
      worldPressure: "The warning became an institutional question rather than a private alarm, and the cost of delay was placed openly against the cost of disbelief.",
      stopCondition: "The chamber prepares to vote, with every senator's position now visible.",
      keyFactUpdates: {
        senateBusiness: "suspension_motion_pending",
        warningStatus: "institutional_question",
      },
      nextScene: {
        sceneId: "senate_chamber_vote",
        timeLabel: "near noon",
        locationLabel: "the Senate chamber",
        situation: "The chamber is ready to vote on suspending business because of the warning.",
        presentActors: [
          { actorRef: "caesar.actor.senator", displayName: "the senator" },
          { actorRef: "caesar.actor.consul", displayName: "the presiding consul" },
          { actorRef: "caesar.actor.senate", displayName: "the assembled senators" },
        ],
      },
      storyComplete: true,
    },
    {
      optionId: "caesar_continue_under_record",
      fromStepId: "senate_response",
      toStepId: "complete",
      sourceRef: "caesar.fixture.warning.continue-under-record",
      settledNarrative: "The senator let debate continue, but required the warning and every objection to be entered in the Senate record.",
      immediateReaction: "The chamber resumed its business more quietly, each speaker aware that silence and ridicule alike would now have an author.",
      worldPressure: "Public business continued, but responsibility for ignoring or acting on the warning could no longer disappear into rumor.",
      stopCondition: "The clerk opens the record as the first speaker rises under the weight of the written warning.",
      keyFactUpdates: {
        senateBusiness: "continued_under_record",
        warningStatus: "entered_in_record",
      },
      nextScene: {
        sceneId: "senate_chamber_record",
        timeLabel: "near noon",
        locationLabel: "the Senate chamber",
        situation: "Debate continues with the warning and objections formally recorded.",
        presentActors: [
          { actorRef: "caesar.actor.senator", displayName: "the senator" },
          { actorRef: "caesar.actor.consul", displayName: "the presiding consul" },
          { actorRef: "caesar.actor.senate", displayName: "the assembled senators" },
        ],
      },
      storyComplete: true,
    },
  ],
};

export const caesarSoloWorldModule = createScriptedWorldModule(caesarSoloConfig);
