# AI 多人故事局 PRD v3.1 补充：PostgreSQL + Prisma 本地数据库落地方案

> 适用文档：`AI_multiplayer_story_RPG_MVP_Codex_PRD_v3_0.md`
> 补充目标：让第一版 MVP 可以在本地完整跑通「创建故事局 → 选择角色 → 提交行动 → AI mock 结算 → 更新世界状态 → 生成章节」闭环。
> 推荐数据库：PostgreSQL 16 + Prisma ORM。
> 推荐本地依赖：Docker Compose 启动 PostgreSQL + Redis；Node.js 服务通过 Prisma 连接数据库；BullMQ 使用 Redis。

---

## 1. 是否需要补数据库？结论

需要补。v3.0 文档已经有数据库模型草案，但还不够直接开发，主要缺少以下内容：

1. 本地 PostgreSQL / Redis 启动方式。
2. `.env.example` 的数据库连接配置。
3. Prisma 初始化、迁移、seed、reset 命令。
4. 可直接复制的 `docker-compose.yml`。
5. 带关系字段、索引、唯一约束的 Prisma schema。
6. 第一版 seed 数据策略。
7. 本地跑通第一章的数据库验收流程。
8. Codex 执行数据库任务的明确指令。

第一版建议不要使用 SQLite。原因：本项目有大量 JSON 状态、多人行动并发、唯一约束、事件日志、AI 任务队列，PostgreSQL 更接近后续真实上线环境。

---

## 2. 本地数据库架构

```txt
本地开发环境：

微信小程序 / Taro 前端
        ↓ HTTP
NestJS API 服务
        ↓ Prisma
PostgreSQL 本地数据库
        ↓
持久化 StoryRun / Role / Node / Action / Resolution / Chapter

NestJS API 服务
        ↓ BullMQ
Redis 本地队列
        ↓
AI mock task / audit mock task / chapter generation task
```

P0 本地必须能跑通：

```txt
1. docker compose up -d
2. pnpm install
3. pnpm db:migrate
4. pnpm db:seed
5. pnpm dev:api
6. pnpm dev:miniprogram
7. pnpm dev:admin
```

---

## 3. Monorepo 中需要新增/确认的文件

```txt
ai-story-run/
  docker-compose.yml
  .env.example
  package.json
  prisma/
    schema.prisma
    seed.ts
  apps/
    api/
      src/
        prisma/
          prisma.module.ts
          prisma.service.ts
        modules/
          story-runs/
          roles/
          scene-nodes/
          actions/
          director/
          chapters/
  packages/
    templates/
      midnight-store.json
      qingyun-sect.json
      wild-village.json
```

---

## 4. 本地 docker-compose.yml

放在项目根目录：

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    container_name: ai_story_run_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ai_story
      POSTGRES_PASSWORD: ai_story_pwd
      POSTGRES_DB: ai_story_run
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ai_story -d ai_story_run"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: ai_story_run_redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: ["redis-server", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
  redis_data:
```

---

## 5. .env.example

放在项目根目录：

```env
# App
NODE_ENV=development
API_PORT=3001
ADMIN_PORT=3002
MINIPROGRAM_API_BASE_URL=http://localhost:3001

# Database
DATABASE_URL="postgresql://ai_story:ai_story_pwd@localhost:5432/ai_story_run?schema=public"

# Redis / BullMQ
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Auth mock
JWT_SECRET="local_dev_secret_change_me"
MOCK_WECHAT_OPENID_PREFIX="mock_openid_"

# AI provider
AI_PROVIDER=mock
AI_MODEL=mock-director-v1
AI_TIMEOUT_MS=30000

# Audit provider
AUDIT_PROVIDER=mock

# Local storage
LOCAL_UPLOAD_DIR=./storage/uploads
LOCAL_POSTER_DIR=./storage/posters

# Feature flags
ENABLE_MOCK_LOGIN=true
ENABLE_MOCK_AI=true
ENABLE_MOCK_AUDIT=true
ENABLE_BULLMQ=true
```

---

## 6. package.json 脚本建议

项目根目录 `package.json` 增加：

```json
{
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "dev:api": "pnpm --filter @apps/api dev",
    "dev:admin": "pnpm --filter @apps/admin dev",
    "dev:miniprogram": "pnpm --filter @apps/miniprogram dev:weapp",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "docker:reset": "docker compose down -v && docker compose up -d",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio",
    "db:reset": "prisma migrate reset --force && pnpm db:seed",
    "test": "pnpm -r test",
    "test:e2e": "pnpm --filter @apps/api test:e2e"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "devDependencies": {
    "prisma": "latest",
    "tsx": "latest"
  },
  "dependencies": {
    "@prisma/client": "latest"
  }
}
```

---

## 7. P0 推荐 Prisma schema

> 说明：P0 阶段状态字段先用 `String`，不强制 Prisma enum，方便快速迭代。等流程稳定后，再把状态字段收敛成 enum。

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id             String   @id @default(cuid())
  openid         String   @unique
  unionid        String?
  nickname       String?
  avatarUrl      String?
  status         String   @default("active")
  policyAgreedAt DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  ownedRuns      StoryRun[]     @relation("StoryRunOwner")
  players        StoryPlayer[]
  actions        PlayerAction[]
  notifications  Notification[]
  eventLogs      EventLog[]
  shareTokens    ShareToken[]

  @@index([status])
  @@index([createdAt])
}

model WorldTemplate {
  id         String   @id
  name       String
  genre      String
  hook       String   @db.Text
  worldBase  String   @db.Text
  status     String   @default("draft")
  configJson Json
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  storyRuns  StoryRun[]

  @@index([status])
  @@index([genre])
}

model StoryRun {
  id                 String   @id @default(cuid())
  templateId          String
  ownerUserId         String
  title               String
  hook                String   @db.Text
  mode                String   @default("invite") // single | invite | public
  status              String   @default("waiting_players")
  currentChapter      Int      @default(1)
  currentNodeId       String?
  maxPlayers          Int      @default(5)
  activeHumanCount    Int      @default(1)
  aiPlayerCount       Int      @default(0)
  dangerLevel         Int      @default(1)
  maxDangerLevel      Int      @default(5)
  chapterCount        Int      @default(0)
  completedNodeCount  Int      @default(0)
  summary             String?  @db.Text
  stateJson           Json
  visibility          String   @default("link") // private | link | public
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  template            WorldTemplate @relation(fields: [templateId], references: [id], onDelete: Restrict)
  owner               User          @relation("StoryRunOwner", fields: [ownerUserId], references: [id], onDelete: Cascade)
  players             StoryPlayer[]
  roles               StoryRole[]
  relations           RoleRelation[]
  sandboxes           ChapterSandbox[]
  nodes               SceneNode[]
  actions             PlayerAction[]
  resolutions         DirectorResolution[]
  narrativeSegments   NarrativeSegment[]
  clues               Clue[]
  snapshots           WorldStateSnapshot[]
  chapters            Chapter[]
  notifications       Notification[]
  aiTasks             AiTask[]
  events              EventLog[]
  shareTokens         ShareToken[]

  @@index([templateId])
  @@index([ownerUserId])
  @@index([status, updatedAt])
  @@index([visibility, status])
}

model StoryPlayer {
  id           String   @id @default(cuid())
  runId        String
  userId       String?
  roleId       String?
  playerType   String   @default("human") // human | ai
  status       String   @default("active")
  joinedAt     DateTime @default(now())
  lastActiveAt DateTime?

  run          StoryRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  user         User?     @relation(fields: [userId], references: [id], onDelete: SetNull)
  role         StoryRole? @relation(fields: [roleId], references: [id], onDelete: SetNull)

  @@unique([runId, userId])
  @@unique([runId, roleId])
  @@index([runId, status])
  @@index([userId])
}

model StoryRole {
  id             String   @id @default(cuid())
  runId          String
  roleKey        String
  roleName       String
  identity       String
  publicInfo     String   @db.Text
  hiddenSecret   String?  @db.Text
  personalGoal   String   @db.Text
  currentState   String   @db.Text
  abilityText    String?  @db.Text
  arcText        String?  @db.Text
  knownInfoJson  Json
  cannotDoJson   Json
  isAiControlled Boolean  @default(false)
  status         String   @default("available") // available | claimed | inactive
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  run            StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  players        StoryPlayer[]
  actions        PlayerAction[]
  ownedClues     Clue[]
  fromRelations  RoleRelation[] @relation("RelationFromRole")
  toRelations    RoleRelation[] @relation("RelationToRole")

  @@unique([runId, roleKey])
  @@index([runId, status])
  @@index([isAiControlled])
}

model RoleRelation {
  id              String   @id @default(cuid())
  runId           String
  fromRoleId      String
  toRoleId        String
  relationType    String // trust | suspicion | debt | protect | conflict | secret
  score           Int      @default(0)
  publicNote      String?  @db.Text
  hiddenNote      String?  @db.Text
  updatedByNodeId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  run             StoryRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  fromRole        StoryRole @relation("RelationFromRole", fields: [fromRoleId], references: [id], onDelete: Cascade)
  toRole          StoryRole @relation("RelationToRole", fields: [toRoleId], references: [id], onDelete: Cascade)

  @@unique([runId, fromRoleId, toRoleId, relationType])
  @@index([runId])
  @@index([fromRoleId])
  @@index([toRoleId])
}

model ChapterSandbox {
  id              String   @id @default(cuid())
  runId           String
  chapterIndex    Int
  title           String
  mainLocation    String
  chapterGoal     String   @db.Text
  currentQuestion String   @db.Text
  sandboxJson     Json
  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  run             StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([runId, chapterIndex])
  @@index([runId, status])
}

model SceneNode {
  id                String   @id @default(cuid())
  runId             String
  chapterIndex      Int
  nodeIndex         Int
  title             String
  publicNarration   String   @db.Text
  nodeGoal          String   @db.Text
  status            String   @default("open_for_actions")
  actionOptionsJson Json
  resolutionId      String?
  openedAt          DateTime @default(now())
  resolvedAt        DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  run               StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  actions           PlayerAction[]
  resolution        DirectorResolution?
  narrativeSegments NarrativeSegment[]
  snapshots         WorldStateSnapshot[]
  aiTasks           AiTask[]
  events            EventLog[]
  notifications     Notification[]

  @@unique([runId, chapterIndex, nodeIndex])
  @@index([runId, status])
  @@index([chapterIndex])
}

model PlayerAction {
  id             String   @id @default(cuid())
  runId          String
  nodeId         String
  chapterIndex   Int
  userId         String?
  roleId         String
  playerType     String   @default("human")
  actionType     String
  targetType     String?
  targetId       String?
  targetText     String?
  method         String   @db.Text
  intent         String   @db.Text
  riskLevel      String   @default("normal") // safe | normal | risky
  freeText       String?  @db.Text
  normalizedJson Json?
  guardStatus    String   @default("pending")
  guardReason    String?  @db.Text
  auditStatus    String   @default("pending")
  status         String   @default("draft")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  run            StoryRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  node           SceneNode @relation(fields: [nodeId], references: [id], onDelete: Cascade)
  user           User?     @relation(fields: [userId], references: [id], onDelete: SetNull)
  role           StoryRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
  aiTasks        AiTask[]
  events         EventLog[]

  @@unique([nodeId, roleId])
  @@index([runId, nodeId])
  @@index([userId])
  @@index([status, auditStatus, guardStatus])
}

model DirectorResolution {
  id                  String   @id @default(cuid())
  runId               String
  nodeId              String   @unique
  chapterIndex        Int
  summary             String   @db.Text
  publicNarration     String   @db.Text
  privateResultsJson  Json
  actionResultsJson   Json
  statePatchJson      Json
  clueChangesJson     Json
  relationChangesJson Json
  dangerBefore        Int
  dangerAfter         Int
  nextNodeHook        String?  @db.Text
  nextOptionsJson     Json?
  auditStatus         String   @default("pending")
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  run                 StoryRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  node                SceneNode @relation(fields: [nodeId], references: [id], onDelete: Cascade)
  narrativeSegments   NarrativeSegment[]

  @@index([runId, chapterIndex])
  @@index([auditStatus])
}

model NarrativeSegment {
  id              String   @id @default(cuid())
  runId           String
  nodeId          String
  resolutionId    String
  chapterIndex    Int
  content         String   @db.Text
  contributorJson Json
  auditStatus     String   @default("pending")
  createdAt       DateTime @default(now())

  run             StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  node            SceneNode @relation(fields: [nodeId], references: [id], onDelete: Cascade)
  resolution      DirectorResolution @relation(fields: [resolutionId], references: [id], onDelete: Cascade)

  @@index([runId, chapterIndex])
  @@index([nodeId])
  @@index([auditStatus])
}

model Clue {
  id               String   @id @default(cuid())
  runId             String
  clueKey           String
  title             String
  description       String   @db.Text
  visibility        String   @default("public") // public | role_private | hidden
  ownerRoleId       String?
  discoveredNodeId  String?
  status            String   @default("active")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  run               StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  ownerRole         StoryRole? @relation(fields: [ownerRoleId], references: [id], onDelete: SetNull)

  @@unique([runId, clueKey])
  @@index([runId, visibility, status])
  @@index([ownerRoleId])
}

model WorldStateSnapshot {
  id           String   @id @default(cuid())
  runId        String
  nodeId       String?
  chapterIndex Int
  stateJson    Json
  factsJson    Json
  createdAt    DateTime @default(now())

  run          StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  node         SceneNode? @relation(fields: [nodeId], references: [id], onDelete: SetNull)

  @@index([runId, createdAt])
  @@index([nodeId])
}

model Chapter {
  id              String   @id @default(cuid())
  runId            String
  chapterIndex     Int
  title            String
  content          String   @db.Text
  highlightsJson   Json
  keyChoicesJson   Json
  contributorJson  Json
  nextHook         String?  @db.Text
  auditStatus      String   @default("pending")
  status           String   @default("generated")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  run              StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  notifications    Notification[]
  aiTasks          AiTask[]
  shareTokens      ShareToken[]

  @@unique([runId, chapterIndex])
  @@index([runId, status])
  @@index([auditStatus])
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  runId     String?
  nodeId    String?
  chapterId String?
  type      String
  title     String
  content   String   @db.Text
  isRead    Boolean  @default(false)
  createdAt DateTime @default(now())

  user      User @relation(fields: [userId], references: [id], onDelete: Cascade)
  run       StoryRun? @relation(fields: [runId], references: [id], onDelete: Cascade)
  node      SceneNode? @relation(fields: [nodeId], references: [id], onDelete: SetNull)
  chapter   Chapter? @relation(fields: [chapterId], references: [id], onDelete: SetNull)

  @@index([userId, isRead, createdAt])
  @@index([runId])
}

model AiTask {
  id            String   @id @default(cuid())
  runId          String?
  nodeId         String?
  actionId       String?
  chapterId      String?
  taskType       String
  modelType      String
  promptVersion  String?
  status         String   @default("pending")
  inputJson      Json?
  resultJson     Json?
  inputTokens    Int?
  outputTokens   Int?
  cost           Float?
  errorMessage   String?  @db.Text
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  run            StoryRun? @relation(fields: [runId], references: [id], onDelete: Cascade)
  node           SceneNode? @relation(fields: [nodeId], references: [id], onDelete: SetNull)
  action         PlayerAction? @relation(fields: [actionId], references: [id], onDelete: SetNull)
  chapter        Chapter? @relation(fields: [chapterId], references: [id], onDelete: SetNull)

  @@index([taskType, status])
  @@index([runId])
  @@index([nodeId])
  @@index([chapterId])
}

model AuditLog {
  id         String   @id @default(cuid())
  targetType String
  targetId   String?
  content    String   @db.Text
  result     String
  riskType   String?
  provider   String   @default("mock")
  createdAt  DateTime @default(now())

  @@index([targetType, targetId])
  @@index([result, createdAt])
}

model EventLog {
  id         String   @id @default(cuid())
  userId     String?
  runId      String?
  nodeId     String?
  actionId   String?
  eventName  String
  source     String?
  shareToken String?
  payload    Json?
  createdAt  DateTime @default(now())

  user       User? @relation(fields: [userId], references: [id], onDelete: SetNull)
  run        StoryRun? @relation(fields: [runId], references: [id], onDelete: Cascade)
  node       SceneNode? @relation(fields: [nodeId], references: [id], onDelete: SetNull)
  action     PlayerAction? @relation(fields: [actionId], references: [id], onDelete: SetNull)

  @@index([eventName, createdAt])
  @@index([userId])
  @@index([runId])
}

model ShareToken {
  id          String   @id @default(cuid())
  token       String   @unique
  runId       String
  chapterId   String?
  shareUserId String
  scene       String
  channel     String
  createdAt   DateTime @default(now())

  run         StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  chapter     Chapter? @relation(fields: [chapterId], references: [id], onDelete: SetNull)
  shareUser   User @relation(fields: [shareUserId], references: [id], onDelete: Cascade)

  @@index([runId])
  @@index([shareUserId])
  @@index([createdAt])
}
```

---

## 8. seed 数据策略

### 8.1 seed 必须创建的数据

P0 本地 seed 至少创建：

1. 3 个 `WorldTemplate`：午夜便利店、青云宗门、穿越荒村。
2. 1 个 mock 用户：`mock_openid_owner_001`。
3. 1 个可直接测试的单人故事局：午夜便利店。
4. 该故事局下的 3 个角色：林鹿、陈舟、顾言。
5. 第 1 章 `ChapterSandbox`。
6. 第 1 个 `SceneNode`。
7. 初始 `Clue`。
8. 初始 `WorldStateSnapshot`。

### 8.2 seed 后本地应该能看到

```txt
GET /api/world-templates
返回 3 个模板。

GET /api/my/story-runs
返回 1 个 demo story run。

GET /api/story-runs/{runId}/current-node
返回午夜便利店第 1 个节点：自动门打开。
```

### 8.3 seed.ts 伪代码

```ts
import { PrismaClient } from '@prisma/client';
import { midnightStoreTemplate } from '../packages/templates/midnight-store';
import { qingyunSectTemplate } from '../packages/templates/qingyun-sect';
import { wildVillageTemplate } from '../packages/templates/wild-village';

const prisma = new PrismaClient();

async function main() {
  await prisma.worldTemplate.upsert({
    where: { id: midnightStoreTemplate.id },
    update: {
      name: midnightStoreTemplate.name,
      genre: midnightStoreTemplate.genre,
      hook: midnightStoreTemplate.hook,
      worldBase: midnightStoreTemplate.worldBase,
      status: 'online',
      configJson: midnightStoreTemplate,
    },
    create: {
      id: midnightStoreTemplate.id,
      name: midnightStoreTemplate.name,
      genre: midnightStoreTemplate.genre,
      hook: midnightStoreTemplate.hook,
      worldBase: midnightStoreTemplate.worldBase,
      status: 'online',
      configJson: midnightStoreTemplate,
    },
  });

  // qingyunSectTemplate / wildVillageTemplate 同理 upsert

  const owner = await prisma.user.upsert({
    where: { openid: 'mock_openid_owner_001' },
    update: {},
    create: {
      openid: 'mock_openid_owner_001',
      nickname: '本地测试用户',
      avatarUrl: '',
      policyAgreedAt: new Date(),
    },
  });

  // 可选：创建 demo StoryRun，方便开发者直接进入故事局调试
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

---

## 9. 本地运行步骤

### 9.1 第一次启动

```bash
# 1. 启动数据库和 Redis
docker compose up -d

# 2. 安装依赖
pnpm install

# 3. 复制环境变量
cp .env.example .env

# 4. 生成 Prisma Client
pnpm db:generate

# 5. 创建迁移并写入数据库
pnpm db:migrate

# 6. 写入 seed 数据
pnpm db:seed

# 7. 打开 Prisma Studio 检查数据
pnpm db:studio

# 8. 启动 API
pnpm dev:api

# 9. 启动小程序
pnpm dev:miniprogram

# 10. 启动后台
pnpm dev:admin
```

### 9.2 每次重置数据库

```bash
pnpm db:reset
```

### 9.3 彻底清空 Docker 数据

```bash
docker compose down -v
docker compose up -d
pnpm db:migrate
pnpm db:seed
```

---

## 10. 本地数据库验收清单

数据库补足后，Codex 必须完成以下验收：

1. `docker compose up -d` 后 PostgreSQL 和 Redis 均为 healthy。
2. `pnpm db:migrate` 可成功生成数据库表。
3. `pnpm db:seed` 可成功创建 3 个模板。
4. Prisma Studio 可看到 `WorldTemplate`、`User`、`StoryRun`。
5. 创建故事局时写入 `StoryRun`、`StoryRole`、`ChapterSandbox`、`SceneNode`、`WorldStateSnapshot`。
6. 选择角色时写入/更新 `StoryPlayer` 和 `StoryRole.status`。
7. 提交行动时写入 `PlayerAction`。
8. 同一节点同一角色重复提交行动必须被唯一约束挡住。
9. 节点结算时写入 `DirectorResolution`、`NarrativeSegment`、`Clue`、`RoleRelation`、`WorldStateSnapshot`。
10. 5 个节点后写入 `Chapter`。
11. `AiTask` 记录 mock AI 调用。
12. `AuditLog` 记录 mock 审核。
13. `EventLog` 记录关键埋点。

---

## 11. 需要修改 PRD v3.0 的位置

建议对原文档做 4 处修改：

### 11.1 修改第 13 节标题

从：

```txt
## 13. 数据库设计 Prisma Schema
```

改成：

```txt
## 13. 数据库设计：PostgreSQL + Prisma 本地可运行方案
```

并替换为本补充文档第 7 节的完整 schema。

### 11.2 在第 21 节技术栈后增加本地运行说明

新增：

```txt
P0 第一版必须使用 PostgreSQL + Prisma，并通过 docker-compose 在本地运行。
Redis 用于 BullMQ AI 任务队列。
所有真实第三方服务在 P0 均使用 mock adapter。
```

### 11.3 在第 25 节 Sprint 1 追加数据库任务

Sprint 1 追加：

```txt
1. 创建 docker-compose.yml，包含 postgres 和 redis。
2. 创建 .env.example。
3. 配置 Prisma schema。
4. 实现 prisma/seed.ts。
5. 添加 db:migrate / db:seed / db:reset / db:studio 脚本。
6. 本地完成一次完整迁移和 seed。
```

### 11.4 在第 26 节 Codex 启动指令中追加

追加：

```txt
第一版数据库必须使用 PostgreSQL + Prisma。
请提供 docker-compose.yml，启动 postgres:16-alpine 和 redis:7-alpine。
请提供 .env.example、prisma/schema.prisma、prisma/seed.ts。
请确保 pnpm db:migrate、pnpm db:seed、pnpm db:studio 可以正常运行。
```

---

## 12. 给 Codex 的数据库补充指令

```txt
请在 docs/PRD_v3.md 的基础上补齐本地数据库方案。

要求：
1. 第一版数据库使用 PostgreSQL + Prisma。
2. 本地使用 docker-compose 启动 PostgreSQL 16 和 Redis 7。
3. 提供 docker-compose.yml。
4. 提供 .env.example。
5. 提供完整 prisma/schema.prisma，必须包含关系、索引、唯一约束。
6. 提供 prisma/seed.ts，至少 seed 3 个 WorldTemplate：午夜便利店、青云宗门、穿越荒村。
7. seed 后必须能创建一个 demo 用户和一个 demo StoryRun。
8. package.json 中加入 db:generate、db:migrate、db:seed、db:reset、db:studio 命令。
9. 后端 NestJS 必须接入 PrismaService。
10. 所有创建故事局、选择角色、提交行动、AI 结算、章节生成流程必须真实写入 PostgreSQL。
11. Redis 暂时用于 BullMQ mock AI 任务队列；如果队列暂未完成，也必须保留 Redis 配置和 adapter。
12. 完成后输出本地运行步骤：docker compose up -d、pnpm install、pnpm db:migrate、pnpm db:seed、pnpm dev:api、pnpm dev:miniprogram、pnpm dev:admin。
```

---

## 13. 第一版可以暂缓的数据库能力

以下能力 P0 不必做复杂：

1. 不做分库分表。
2. 不做读写分离。
3. 不做复杂权限表。
4. 不做付费订单表。
5. 不做创作者收益表。
6. 不做大规模推荐系统表。
7. 不做复杂版本化世界观表。
8. 不做向量数据库。
9. 不做全文搜索。
10. 不做 S3 / OSS 真实存储，分享海报可先 mock URL。

---

## 14. 后续上线前再补的数据库能力

P1/P2 再考虑：

1. PaymentOrder：支付订单。
2. UserWallet / CreditBalance：故事能量或次数包。
3. TemplateMarketplace：模板市场。
4. UserCreatedWorld：用户自建世界。
5. Like / Favorite / Comment：社区互动。
6. UserProfile：用户主页。
7. ModerationCase：人工审核工作流。
8. Asset：海报、角色图、背景图资源管理。
9. SearchIndex：故事和模板检索。
10. RecommendationLog：推荐曝光和点击。
