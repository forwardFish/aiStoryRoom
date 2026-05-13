import { PrismaClient } from "@prisma/client";
import { midnightStoreTemplate, templates } from "@ai-story/templates";

const prisma = new PrismaClient();

function inviteCode(seed: string): string {
  return seed.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6).padEnd(6, "A");
}

async function createRunForTemplate(ownerUserId: string) {
  const run = await prisma.storyRun.upsert({
    where: { inviteCode: "LOCAL1" },
    update: {},
    create: {
      templateId: midnightStoreTemplate.id,
      ownerUserId,
      title: "午夜便利店：没有影子的客人",
      hook: midnightStoreTemplate.hook,
      mode: "single",
      status: "playing",
      maxPlayers: 3,
      activeHumanCount: 1,
      aiPlayerCount: 2,
      stateJson: {
        tone: "悬疑",
        currentQuestion: "没有影子的客人是否真实存在",
        dangerLevel: 1
      },
      visibility: "private",
      inviteCode: inviteCode("local1")
    }
  });

  await prisma.chapterSandbox.upsert({
    where: { runId_chapterIndex: { runId: run.id, chapterIndex: 1 } },
    update: {},
    create: {
      runId: run.id,
      chapterIndex: 1,
      title: "第 1 章：没有影子的客人",
      mainLocation: "午夜便利店",
      chapterGoal: "确认没有影子的客人和缺失监控之间的联系。",
      currentQuestion: "自动门为什么会在无人靠近时打开？",
      sandboxJson: midnightStoreTemplate
    }
  });

  for (const role of midnightStoreTemplate.roles) {
    await prisma.storyRole.upsert({
      where: { runId_roleKey: { runId: run.id, roleKey: role.roleKey } },
      update: {},
      create: {
        runId: run.id,
        roleKey: role.roleKey,
        roleName: role.roleName,
        identity: role.identity,
        publicInfo: role.publicInfo,
        hiddenSecret: role.hiddenSecret,
        personalGoal: role.personalGoal,
        currentState: role.currentState,
        abilityText: role.abilityText,
        arcText: role.arcText,
        knownInfoJson: role.knownInfo,
        cannotDoJson: role.cannotDo,
        isAiControlled: role.roleKey !== "lin_lu",
        status: role.roleKey === "lin_lu" ? "available" : "claimed"
      }
    });
  }

  const firstNode = midnightStoreTemplate.nodes[0];
  const sceneNode = await prisma.sceneNode.upsert({
    where: { runId_chapterIndex_nodeIndex: { runId: run.id, chapterIndex: 1, nodeIndex: 1 } },
    update: {},
    create: {
      runId: run.id,
      chapterIndex: 1,
      nodeIndex: 1,
      title: firstNode.title,
      publicNarration: firstNode.publicNarration,
      nodeGoal: firstNode.nodeGoal,
      actionOptionsJson: firstNode.actionOptions
    }
  });

  await prisma.storyRun.update({
    where: { id: run.id },
    data: { currentNodeId: sceneNode.id }
  });

  for (const clue of midnightStoreTemplate.initialClues) {
    await prisma.clue.upsert({
      where: { runId_clueKey: { runId: run.id, clueKey: clue.clueKey } },
      update: {},
      create: {
        runId: run.id,
        clueKey: clue.clueKey,
        title: clue.title,
        description: clue.description,
        visibility: "public",
        discoveredNodeId: sceneNode.id
      }
    });
  }

  await prisma.worldStateSnapshot.create({
    data: {
      runId: run.id,
      nodeId: sceneNode.id,
      chapterIndex: 1,
      stateJson: { dangerLevel: 1, currentNode: firstNode.title },
      factsJson: { publicFacts: ["自动门在凌晨 2:17 自行打开"] }
    }
  });
}

async function main() {
  for (const template of templates) {
    await prisma.worldTemplate.upsert({
      where: { id: template.id },
      update: {
        name: template.name,
        genre: template.genre,
        hook: template.hook,
        worldBase: template.worldBase,
        status: "online",
        configJson: template
      },
      create: {
        id: template.id,
        name: template.name,
        genre: template.genre,
        hook: template.hook,
        worldBase: template.worldBase,
        status: "online",
        configJson: template
      }
    });
  }

  const owner = await prisma.user.upsert({
    where: { openid: "mock_openid_owner_001" },
    update: {},
    create: {
      openid: "mock_openid_owner_001",
      nickname: "本地测试用户",
      avatarUrl: "",
      policyAgreedAt: new Date()
    }
  });

  await createRunForTemplate(owner.id);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
