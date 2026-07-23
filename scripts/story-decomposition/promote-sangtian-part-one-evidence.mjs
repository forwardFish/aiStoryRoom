import { copyFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalize,
  readJson,
  repoRoot,
  sha256Bytes,
  validateWithSchema,
  writeJson,
} from "./lib/contract-utils.mjs";

const CANDIDATE_RUN_ID = "sangtian-part-one-evidence-seed-v5";
const RELEASE_ID = "sangtian-part-one-evidence-v1.0.0";
const RELEASED_AT = "2026-07-23T00:00:00.000Z";
const derivedRoot = resolve(repoRoot, "docs/剧本/嘉靖财政危局/derived/evidence-v2");
const candidateRunRoot = resolve(derivedRoot, "candidates", CANDIDATE_RUN_ID);
const candidateRoot = resolve(candidateRunRoot, "track-a-evidence");
const publishedRoot = resolve(derivedRoot, "published", RELEASE_ID);
const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");

const bindings = {
  "REQ-P1-EXECUTION-BOUNDARY": {
    scenes: ["DM1566-C01-POLICY-COUNCIL", "DM1566-C03-GOVERNOR-POLITICAL-BOUNDARY", "DM1566-C04-JOINT-REPORT-CONTEST"],
    claims: ["DM1566-C01-CL-POLICY-HALF-LAND", "DM1566-C01-CL-POLICY-FOOD-QUESTION", "DM1566-C01-CL-POLICY-URGENT-DISPATCH", "DM1566-C03-CL-GOVERNOR-INVARIANT", "DM1566-C03-CL-GRADUAL-EXECUTION-OPTION", "DM1566-C04-CL-GOVERNOR-DEMANDS-REPORT-CHANGE"],
    adaptations: ["ADAPT-P1-PLAYABLE-GOVERNOR", "ADAPT-P1-THREE-DAY-DEADLINE"], strength: "EXPLICIT",
  },
  "REQ-P1-RESPONSIBILITY-RECORD": {
    scenes: ["DM1566-C01-POLICY-COUNCIL", "DM1566-C04-JOINT-REPORT-CONTEST"],
    claims: ["DM1566-C01-CL-POLICY-RESPONSIBILITY", "DM1566-C04-CL-REPORT-OMITS-DELAY", "DM1566-C04-CL-GOVERNOR-DEMANDS-REPORT-CHANGE", "DM1566-C04-CL-WEAVING-REFUSES-SIGNATURE", "DM1566-C04-CL-CONFESSION-CHANGES-NEGOTIATION"],
    adaptations: ["ADAPT-P1-PLAYABLE-GOVERNOR", "ADAPT-P1-SEPARATE-XUNFU"], strength: "EXPLICIT",
  },
  "REQ-P1-XUNFU-COUNTERMOVE": {
    scenes: ["DM1566-C03-GOVERNOR-POLITICAL-BOUNDARY", "DM1566-C04-JOINT-REPORT-CONTEST", "DM1566-C04-REPORT-AND-LETTER-REACH-YAN"],
    claims: ["DM1566-C03-CL-REJECTION-DOCUMENT-SHOWN", "DM1566-C04-CL-REPORT-AND-LETTER-REACH-YAN", "DM1566-C04-CL-REPORT-PROVOKES-IMMEDIATE-REACTION"],
    adaptations: ["ADAPT-P1-SEPARATE-XUNFU"], strength: "WEAK_INFERENCE",
  },
  "REQ-P1-REGISTER-CUSTODY": {
    scenes: ["DM1566-C07-MERCHANT-LEDGER-BARGAIN", "DM1566-C13-LEDGERS-BURNED", "DM1566-C13-OTHER-LEDGER-BOXES-HELD", "DM1566-C23-TESTIMONY-SEALED"],
    claims: ["DM1566-C07-CL-LEDGER-ACCESS-RESTRICTED", "DM1566-C07-CL-LEDGER-PARTIAL-ORAL-TRANSFER", "DM1566-C13-CL-FOUR-LEDGER-BOXES-BURNED", "DM1566-C13-CL-OTHER-FOUR-LEDGER-BOXES-HELD", "DM1566-C23-CL-ORIGINAL-RETRACTIONS-WITNESS-STATEMENTS-COMBINED", "DM1566-C23-CL-HAI-SEALS-BUNDLE-WITH-THREE-FEATHERS", "DM1566-C23-CL-WANG-SEAL-NOT-ADDED"],
    adaptations: ["ADAPT-P1-QINGLIU-COUNTY", "ADAPT-P1-REGISTER-ALTERATION"], strength: "EXPLICIT",
  },
  "REQ-P1-REVIEW-AUTHORITY": {
    scenes: ["DM1566-C03-GOVERNOR-POLITICAL-BOUNDARY", "DM1566-C04-JOINT-REPORT-CONTEST", "DM1566-C23-TESTIMONY-SEALED"],
    claims: ["DM1566-C03-CL-REJECTION-DOCUMENT-SHOWN", "DM1566-C03-CL-KNOWLEDGE-REFUSAL", "DM1566-C04-CL-GOVERNOR-DEMANDS-REPORT-CHANGE", "DM1566-C04-CL-WEAVING-REFUSES-SIGNATURE", "DM1566-C23-CL-TESTIMONY-SIGNED-BY-TWO-WITNESSES"],
    adaptations: ["ADAPT-P1-QINGLIU-COUNTY", "ADAPT-P1-SEPARATE-XUNFU"], strength: "STRONG_INFERENCE",
  },
  "REQ-P1-KNOWLEDGE-CHAIN": {
    scenes: ["DM1566-C02-REPORT-ARRIVES-YAN-HOUSE", "DM1566-C03-GOVERNOR-POLITICAL-BOUNDARY", "DM1566-C04-REPORT-AND-LETTER-REACH-YAN", "DM1566-C07-MERCHANT-LEDGER-BARGAIN", "DM1566-C23-TESTIMONY-SEALED", "DM1566-C23-URGENT-DISPATCH-AT-GATE"],
    claims: ["DM1566-C02-CL-REPORT-BYPASSES-TONGZHENG", "DM1566-C02-CL-REPORT-REACHES-YAN-HOUSE", "DM1566-C03-CL-REJECTION-DOCUMENT-SHOWN", "DM1566-C04-CL-REPORT-AND-LETTER-REACH-YAN", "DM1566-C07-CL-LEDGER-PARTIAL-ORAL-TRANSFER", "DM1566-C23-CL-ORIGINAL-RETRACTIONS-WITNESS-STATEMENTS-COMBINED", "DM1566-C23-CL-ESCORT-PRODUCES-THREE-FEATHER-DISPATCH"],
    adaptations: ["ADAPT-P1-SHADOW-LEDGER-ENTRY"], strength: "EXPLICIT",
  },
  "REQ-P1-GRAIN-RELIEF": {
    scenes: ["DM1566-C02-GOVERNOR-GRAIN-RESPONSIBILITY", "DM1566-C05-GRAIN-LAND-SAFEGUARD", "DM1566-C06-LAND-PRICE-DEBATE"],
    claims: ["DM1566-C02-CL-GRAIN-SOURCES-INSUFFICIENT", "DM1566-C02-CL-GOVERNOR-ORDERS-RELIEF", "DM1566-C05-CL-GOVERNOR-SEEKS-EXTERNAL-GRAIN", "DM1566-C06-CL-GRAIN-DEADLINE-COUNTERMOVE"],
    adaptations: [], strength: "EXPLICIT",
  },
  "REQ-P1-MERCHANT-CONDITIONS": {
    scenes: ["DM1566-C01-LAND-RISK-COUNCIL", "DM1566-C06-LAND-PRICE-DEBATE", "DM1566-C07-MERCHANT-LEDGER-BARGAIN"],
    claims: ["DM1566-C01-CL-LAND-PROFIT-MECHANISM", "DM1566-C06-CL-GRAIN-DEADLINE-COUNTERMOVE", "DM1566-C07-CL-LEDGER-ACCESS-RESTRICTED", "DM1566-C07-CL-MERCHANT-OFFERS-CAREER-EXIT", "DM1566-C07-CL-MERCHANT-ARGUES-EMPLOYMENT-OFFSET"],
    adaptations: ["ADAPT-P1-MERCHANT-GUILD"], strength: "STRONG_INFERENCE",
  },
  "REQ-P1-LAND-RISK": {
    scenes: ["DM1566-C01-LAND-RISK-COUNCIL", "DM1566-C05-GRAIN-LAND-SAFEGUARD", "DM1566-C06-LAND-PRICE-DEBATE", "DM1566-C07-MERCHANT-LEDGER-BARGAIN"],
    claims: ["DM1566-C01-CL-LAND-RISK-PREDICTION", "DM1566-C01-CL-LAND-PROFIT-MECHANISM", "DM1566-C05-CL-LAND-PRICE-AUTHORITY-QUESTION", "DM1566-C05-CL-LAND-MINIMUM-PRICE-SAFEGUARD", "DM1566-C05-CL-DISTRIBUTED-REFORM-SCOPE", "DM1566-C06-CL-PLAN-OMITS-LAND-COST", "DM1566-C06-CL-PUBLIC-PRICE-FLOOR", "DM1566-C07-CL-MERCHANT-ARGUES-EMPLOYMENT-OFFSET"],
    adaptations: ["ADAPT-P1-MERCHANT-GUILD"], strength: "EXPLICIT",
  },
  "REQ-P1-REPORT-AUTHORSHIP": {
    scenes: ["DM1566-C02-REPORT-ARRIVES-YAN-HOUSE", "DM1566-C02-REPORT-AUDIENCE-FRAMING", "DM1566-C04-JOINT-REPORT-CONTEST", "DM1566-C04-REPORT-AND-LETTER-REACH-YAN"],
    claims: ["DM1566-C02-CL-REPORT-REACHES-YAN-HOUSE", "DM1566-C02-CL-REPORT-FRAMING-AT-AUDIENCE", "DM1566-C04-CL-REPORT-OMITS-DELAY", "DM1566-C04-CL-GOVERNOR-DEMANDS-REPORT-CHANGE", "DM1566-C04-CL-WEAVING-REFUSES-SIGNATURE", "DM1566-C04-CL-REPORT-AND-LETTER-REACH-YAN"],
    adaptations: ["ADAPT-P1-SEPARATE-XUNFU"], strength: "EXPLICIT",
  },
  "REQ-P1-EVIDENCE-ATTACHMENT": {
    scenes: ["DM1566-C07-MERCHANT-LEDGER-BARGAIN", "DM1566-C13-LEDGERS-BURNED", "DM1566-C13-OTHER-LEDGER-BOXES-HELD", "DM1566-C23-TESTIMONY-SEALED", "DM1566-C23-URGENT-DISPATCH-AT-GATE"],
    claims: ["DM1566-C07-CL-LEDGER-ACCESS-RESTRICTED", "DM1566-C13-CL-FOUR-LEDGER-BOXES-BURNED", "DM1566-C13-CL-OTHER-FOUR-LEDGER-BOXES-HELD", "DM1566-C23-CL-ORIGINAL-RETRACTIONS-WITNESS-STATEMENTS-COMBINED", "DM1566-C23-CL-HAI-SEALS-BUNDLE-WITH-THREE-FEATHERS", "DM1566-C23-CL-WANG-SEAL-NOT-ADDED", "DM1566-C23-CL-ESCORT-PRODUCES-THREE-FEATHER-DISPATCH"],
    adaptations: ["ADAPT-P1-REGISTER-ALTERATION", "ADAPT-P1-SHADOW-LEDGER-ENTRY"], strength: "EXPLICIT",
  },
  "REQ-P1-CAPITAL-FRAMING": {
    scenes: ["DM1566-C02-REPORT-ARRIVES-YAN-HOUSE", "DM1566-C02-REPORT-AUDIENCE-FRAMING", "DM1566-C02-REPORT-SUPPRESSION-RISK", "DM1566-C04-REPORT-AND-LETTER-REACH-YAN", "DM1566-C23-URGENT-DISPATCH-AT-GATE"],
    claims: ["DM1566-C02-CL-REPORT-REACHES-YAN-HOUSE", "DM1566-C02-CL-REPORT-CHANNEL-INTERPRETED-POLITICALLY", "DM1566-C02-CL-REPORT-FRAMING-AT-AUDIENCE", "DM1566-C02-CL-REPORT-CAN-BE-SUPPRESSED", "DM1566-C04-CL-REPORT-AND-LETTER-REACH-YAN", "DM1566-C04-CL-REPORT-PROVOKES-IMMEDIATE-REACTION", "DM1566-C23-CL-ESCORT-EXPLAINS-DISPATCH-PROVENANCE", "DM1566-C23-CL-SHI-ORDERS-PERSONAL-DELIVERY-TO-CHEN"],
    adaptations: [], strength: "EXPLICIT",
  },
};

async function copyJsonFiles(from, to, suffix) {
  await mkdir(to, { recursive: true });
  const names = (await readdir(from)).filter((name) => name.endsWith(suffix)).sort();
  for (const name of names) await copyFile(resolve(from, name), resolve(to, name));
  return names;
}

const candidateManifest = await readJson(resolve(candidateRoot, "manifest.json"));
const reviewSet = await readJson(resolve(candidateRunRoot, "reviews/review-set.json"));
if (reviewSet.verdict !== "PASS" || reviewSet.sceneReviewCount !== candidateManifest.sceneCount) {
  throw new Error(`Evidence release blocked: review verdict=${reviewSet.verdict}, reviews=${reviewSet.sceneReviewCount}/${candidateManifest.sceneCount}`);
}
if (!reviewSet.reviews.every((review) => review.verdict === "PASS" && review.providerCallCount !== 0)) {
  // providerCallCount is recorded in raw records, not review rows; only the PASS assertion is relevant here.
  if (!reviewSet.reviews.every((review) => review.verdict === "PASS")) throw new Error("Evidence release blocked by a failed scene review");
}

const sceneFiles = await copyJsonFiles(resolve(candidateRoot, "scenes"), resolve(publishedRoot, "scenes"), ".scene.json");
const claimFiles = await copyJsonFiles(resolve(candidateRoot, "claims"), resolve(publishedRoot, "claims"), ".claims.json");
const reviewFiles = await copyJsonFiles(resolve(candidateRunRoot, "reviews"), resolve(publishedRoot, "reviews"), ".review.json");
const rawReviewFiles = await copyJsonFiles(resolve(candidateRunRoot, "reviews/raw"), resolve(publishedRoot, "reviews/raw"), ".provider.json");
await copyFile(resolve(candidateRunRoot, "reviews/review-set.json"), resolve(publishedRoot, "reviews/review-set.json"));

if (rawReviewFiles.length !== reviewSet.sceneReviewCount || reviewSet.providerCallCount !== reviewSet.sceneReviewCount) {
  throw new Error(`Evidence release blocked: provider record count=${rawReviewFiles.length}, aggregate calls=${reviewSet.providerCallCount}`);
}
for (const review of reviewSet.reviews) {
  const sceneId = review.reviewId.replace(/^REVIEW-/, "").replace(/-R1$/, "");
  const raw = await readJson(resolve(candidateRunRoot, "reviews/raw", `${sceneId}.provider.json`));
  const actualRecordHash = sha256Bytes(Buffer.from(JSON.stringify(raw), "utf8"));
  if (raw.providerCallCount !== 1 || raw.httpStatus !== 200 || actualRecordHash !== review.providerRecordHash) {
    throw new Error(`${sceneId} provider proof is invalid`);
  }
}

const allSceneIds = new Set();
const allClaimIds = new Set();
const sceneById = new Map();
const claimById = new Map();
for (const name of sceneFiles) {
  const scene = await readJson(resolve(publishedRoot, "scenes", name));
  const validation = await validateWithSchema("scene-evidence-v2", scene);
  if (!validation.valid) throw new Error(`${scene.sceneId} failed published scene schema`);
  allSceneIds.add(scene.sceneId); sceneById.set(scene.sceneId, scene);
}
for (const name of claimFiles) {
  const claimSet = await readJson(resolve(publishedRoot, "claims", name));
  for (const claim of claimSet.claims) {
    const validation = await validateWithSchema("evidence-claim-v2", claim);
    if (!validation.valid) throw new Error(`${claim.claimId} failed published claim schema`);
    allClaimIds.add(claim.claimId); claimById.set(claim.claimId, claim);
  }
}

for (const [requirementId, binding] of Object.entries(bindings)) {
  for (const sceneId of binding.scenes) if (!allSceneIds.has(sceneId)) throw new Error(`${requirementId} references unknown scene ${sceneId}`);
  for (const claimId of binding.claims) if (!allClaimIds.has(claimId)) throw new Error(`${requirementId} references unknown claim ${claimId}`);
}

const requirementSet = await readJson(resolve(authoringRoot, "requirements/part-01.requirements.json"));
const resolutionSet = await readJson(resolve(authoringRoot, "source-resolution/part-01.coverage.json"));
const resolutionByRequirement = new Map(resolutionSet.resolutions.map((entry) => [entry.requirementId, entry]));
for (const requirement of requirementSet.requirements) {
  const binding = bindings[requirement.requirementId];
  if (!binding) throw new Error(`No evidence binding for ${requirement.requirementId}`);
  requirement.sourceSceneIds = [...binding.scenes];
  requirement.sourceClaimIds = [...binding.claims];
  requirement.mechanismCandidateIds = [`GMC-${requirement.requirementId.replace(/^REQ-/, "")}`];
  requirement.evidenceStrength = binding.strength;
  requirement.adaptationGapIds = [...binding.adaptations];
  requirement.adaptationDecisionIds = [];
  requirement.runtimeAssetIds = [];
  requirement.delayedConsequenceRuleIds = [`PCR-${requirement.requirementId.replace(/^REQ-/, "")}`];
  requirement.coverageStatus = binding.adaptations.length ? "BLOCKED_MISSING_EVIDENCE" : "SATISFIED_BY_SOURCE";

  const resolution = resolutionByRequirement.get(requirement.requirementId);
  if (!resolution) throw new Error(`No source resolution for ${requirement.requirementId}`);
  const selectedFromEvidence = binding.scenes.map((sceneId, index) => {
    const scene = sceneById.get(sceneId);
    return {
      candidateId: `${requirement.requirementId}-PUBLISHED-${String(index + 1).padStart(2, "0")}`,
      chapterId: scene.chapterId,
      sourceRefs: scene.sourceRefs,
      matchedMechanisms: requirement.requiredEvidenceMechanisms,
      relevance: "HIGH",
      selection: "SELECTED",
      reason: `Selected from ${RELEASE_ID}; source/hash/schema validation and independent DeepSeek review passed.`,
    };
  });
  resolution.candidateScenes = [
    ...selectedFromEvidence,
    ...resolution.candidateScenes
      .filter((candidate) => !candidate.candidateId.startsWith(`${requirement.requirementId}-PUBLISHED-`))
      .map((candidate) => ({
        ...candidate,
        selection: "REJECTED",
        reason: `${String(candidate.reason).replace(/(?: Not selected after reviewed evidence binding\.)+$/u, "")} Not selected after reviewed evidence binding.`,
      })),
  ];
  resolution.coveredMechanisms = [...requirement.requiredEvidenceMechanisms];
  resolution.missingMechanisms = binding.adaptations.length ? ["具体游戏实体或时限需由已批准 Adaptation Decision 提供"] : [];
  resolution.recommendedAdaptationGaps = [...binding.adaptations];
  resolution.reviewerStatus = "PASS";
}

await writeJson(resolve(authoringRoot, "requirements/part-01.requirements.json"), requirementSet);
await writeJson(resolve(authoringRoot, "source-resolution/part-01.coverage.json"), resolutionSet);
await writeJson(resolve(authoringRoot, "requirements/part-01.evidence-bindings.json"), {
  schemaVersion: "sangtian-requirement-evidence-bindings-v1",
  evidenceReleaseId: RELEASE_ID,
  bindings,
});

const manifestBase = {
  schemaVersion: "sangtian-published-evidence-release-v1",
  releaseId: RELEASE_ID,
  basedOnCandidateRunId: CANDIDATE_RUN_ID,
  sourceSha256: candidateManifest.sourceSha256,
  reviewerVersion: reviewSet.reviewerVersion,
  provider: reviewSet.provider,
  model: reviewSet.reviews[0]?.model ?? reviewSet.model,
  sceneCount: sceneFiles.length,
  claimCount: allClaimIds.size,
  reviewCount: reviewFiles.length,
  providerRecordCount: rawReviewFiles.length,
  candidateManifestHash: sha256Bytes(Buffer.from(canonicalize(candidateManifest), "utf8")),
  reviewSetHash: sha256Bytes(Buffer.from(canonicalize(reviewSet), "utf8")),
  releasedAt: RELEASED_AT,
};
const manifest = { ...manifestBase, immutableHash: sha256Bytes(Buffer.from(canonicalize(manifestBase), "utf8")) };
await writeJson(resolve(publishedRoot, "manifest.json"), manifest);
console.log(JSON.stringify({ publishedRoot, ...manifest, requirementBindingCount: Object.keys(bindings).length }, null, 2));
