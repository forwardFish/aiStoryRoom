# Our Many Worlds MVP 短视频母版、素材生产与批量生成实施文档 v1.0

- 产品：Our Many Worlds
- 首发世界：Caesar — The Last Spring of the Republic
- 目标：用 20—30 秒竖屏短视频，让陌生用户在前三秒停留、在中段完成一次心理选择，并直接进入可玩的凯撒危局。
- 标准母版：**命运终点 → 时间倒带 → 角色抉择 → 连锁后果 → 产品机制 → Logo**
- 标准规格：9:16、1080×1920、24fps、27 秒。

> 本文把已经确认的创意母版转成可执行的视频生产合同。仓库中的 `marketing/video-kit` 负责校验剧情 JSON，并生成分镜 SVG、字幕、剪辑决策表、素材清单和 manifest；它不替代 CapCut、剪映、Premiere、After Effects 或现有 Logo 视频。

---

## 1. MVP 阶段只解决一个营销问题

第一批短视频不承担完整产品教育。它只需要让用户理解四件事：

1. 历史已经有一个著名结局；
2. 用户会成为结局中的关键角色；
3. 用户可以做出无法两全的决定；
4. 一个决定会改变其他角色和同一个世界。

不要以前三秒介绍 AI、多人模式、Credits、世界大厅或技术能力。陌生用户不会因为“AI-powered multiplayer narrative platform”停止滑动，却会因为“你是布鲁图斯，你会不会背叛信任你的人”开始代入。

核心传播句：

```text
CAN YOU CHANGE CAESAR'S FATE?
```

核心差异句：

```text
EVERY PLAYER CHOOSES.
EVERY CHOICE CHANGES THE SAME WORLD.
```

核心 CTA：

```text
PLAY AS BRUTUS.
```

---

## 2. 用户心理设计

### 2.1 前三秒：未完成的问题

命运终点先于产品名称出现。用户看到凯撒的结局后，立即收到挑战：“你能改变吗？”这会建立一个未闭合的问题，促使用户继续看倒带和选择。

危机画面必须清楚但非血腥。使用倒下的桂冠、震惊的人群、封闭的元老院、掉落的文书等象征物，不使用伤口特写或夸张暴力细节。

### 2.2 角色代入：从旁观者变为责任人

`YOU ARE BRUTUS.` 比“体验古罗马世界”更有效，因为它立即回答“我是谁”。第二句必须建立关系：`CAESAR TRUSTS YOU.` 用户分享或点击的不是历史知识，而是自己面对这段关系时会怎样行动。

### 2.3 无法两全：制造真正的心理选择

好选择不能是明显的正确、普通、错误。凯撒首条视频使用：

```text
WARN CAESAR
JOIN CASSIUS
DECEIVE THEM BOTH
```

三项分别代表公开站队、加入另一方、有限双面谋划。观众在结果公布前保留约一秒，先在脑内作答。

### 2.4 可见因果：证明这不是普通互动小说

后果必须写成具体事件：

```text
CAESAR DELAYS THE SENATE MEETING.
CASSIUS SUSPECTS A TRAITOR.
ANTONY MOBILIZES THE GUARDS.
```

不要只展示 `Trust -5`、`Influence +2`。陌生观众必须立即看懂“因为布鲁图斯做了什么，另外三个人改变了什么”。

### 2.5 身份延续：CTA 不是跳出剧情

视频已让用户成为布鲁图斯，最后就应使用 `PLAY AS BRUTUS.`，落地页也必须直接打开布鲁图斯危局，而不是让用户重新浏览首页和选择世界。

---

## 3. 27 秒固定时间线

| 场次 | 时间 | 功能 | 固定要求 |
|---|---:|---|---|
| 01 | 0.0—1.8s | 命运终点 | 最严重但非血腥的结果；Logo 不出现 |
| 02 | 1.8—3.2s | 观众挑战 | `CAN YOU CHANGE HIS FATE?` |
| 03 | 3.2—5.0s | 时间倒带 | 3—4 张静态图反向快速切换 |
| 04 | 5.0—7.2s | 角色代入 | `YOU ARE...` + 一条关系 |
| 05 | 7.2—10.2s | 剧情冲突 | 两方要求 + 无法两全的问题 |
| 06 | 10.2—13.6s | 观众选择 | 三项策略，至少停顿约一秒 |
| 07 | 13.6—14.5s | 选择确认 | 高亮选中项，其他项淡出 |
| 08 | 14.5—19.8s | 连锁后果 | 三名角色 + 一个世界结果 |
| 09 | 19.8—23.0s | 产品机制 | 每人选择、共同改变同一世界 |
| 10 | 23.0—27.0s | Logo 与 CTA | 复用现有 Logo 视频，只留一个 CTA |

十段时长必须精确相加为 JSON 中的 `format.durationSeconds`。生成器会 fail-closed 拒绝错误总时长、错误选择数和错误后果数。

---

## 4. 凯撒首条视频完整脚本

### 01 命运终点

画面：元老院危机后的象征性场景，凯撒被前景长袍遮挡，桂冠落地，元老们震惊后退。

```text
CAESAR IS DEAD.
```

音频：低沉冲击音；音乐立即收紧。

### 02 挑战

冻结画面并轻微虚化背景：

```text
CAN YOU CHANGE HIS FATE?
```

### 03 倒带

用三张图在 1.8 秒内反向切换：危机现场 → 凯撒走向元老院 → 凯撒受罗马人拥护。配倒带扫频，不做长动画。

### 04 身份

```text
YOU ARE BRUTUS.
CAESAR TRUSTS YOU.
```

画面：布鲁图斯独立立绘，手持未拆封信件，明亮大理石走廊，背景低对比。

### 05 冲突

```text
CASSIUS WANTS YOU TO BETRAY CAESAR.
BUT CAESAR CALLS YOU HIS FRIEND.

SAVE A FRIEND
OR SAVE THE REPUBLIC?
```

画面可采用左右双人物卡，避免依赖口型和连续表演。

### 06—07 选择

展示真实产品 UI 或忠实复刻：

```text
WHAT WOULD YOU DO?

WARN CAESAR
JOIN CASSIUS
DECEIVE THEM BOTH
```

停顿后高亮第三项：

```text
YOU CHOOSE:
DECEIVE THEM BOTH
```

### 08 连锁后果

三张人物结果卡依次出现，每张约 1.5 秒：

```text
CAESAR
DELAYS THE SENATE MEETING.

CASSIUS
SUSPECTS A TRAITOR.

ANTONY
MOBILIZES THE GUARDS.

ROME ENTERS A NEW CRISIS.
```

### 09 产品机制

```text
EVERY PLAYER CHOOSES.
EVERY CHOICE CHANGES THE SAME WORLD.
```

画面：四到五名角色卡连接到同一个 Rome 节点，并短暂闪现真实游戏页面。

### 10 片尾

接现有 Logo 视频：

```text
OUR MANY WORLDS
PLAY AS BRUTUS.
```

---

## 5. 可替换数据合同

每条新视频只替换以下字段：

| 变量 | 凯撒示例 |
|---|---|
| `videoId` | `caesar-brutus-fate` |
| `creativeAngle` | `change-history` |
| `world` | Rome, 44 BC |
| `hook.endpoint` | CAESAR IS DEAD. |
| `hook.question` | CAN YOU CHANGE HIS FATE? |
| `player.roleLine` | YOU ARE BRUTUS. |
| `player.relationshipLine` | CAESAR TRUSTS YOU. |
| `conflict.lines` | Cassius 的要求、Caesar 的信任 |
| `conflict.dilemmaLines` | Friend or Republic |
| `choices` | 三个不同策略 |
| `selectedChoiceId` | 本条视频公布的选择 |
| `consequences` | 三个具体跨角色结果 |
| `worldResult` | 一个世界级变化 |
| `assets` | 正式人物、场景、UI、Logo 路径 |
| `publish.landingPath` | 对应角色的深链和 UTM |

同一母版可用于凯撒、桑田诏、哈姆雷特、泰坦尼克等世界；固定的是生产系统，不是每条视频的观看内容。

---

## 6. 素材目录与命名

建议正式素材使用以下结构：

```text
marketing/video-kit/assets/source/
├── brand/
│   └── our-many-worlds-logo.mp4
├── ui/
│   └── caesar-choice-screen.png
└── caesar/
    ├── 01-hook-fate.png
    ├── 02-rewind-crisis.png
    ├── 03-rewind-senate.png
    ├── 04-rewind-triumph.png
    ├── brutus.png
    ├── caesar.png
    ├── cassius.png
    ├── antony.png
    └── rome-senate.png
```

仓库不应提交无授权影视剧截图、音乐或他人商用素材。SVG 仅用于分镜、构图、安全区和交付验收；正式成片应替换为统一画风的人物图、真实游戏 UI、现有 Logo 视频和已授权音频。

### 人物图要求

- 胸像或半身透明 PNG；
- 同一世界统一年龄、服装、面部特征、光向和画风；
- 重要人物避免全部居中大头照，可通过侧视、信件、柱廊和前景形成剧情构图；
- 竖屏主体不得被字幕安全区遮挡。

### 场景图要求

- 明亮、低对比、保留文字负空间；
- 一眼能读出地点和危机；
- 钩子可以有紧张感，但必须保持非血腥、广告平台友好；
- 倒带图尽量保持相同人物、服装和时间方向。

### UI 要求

至少一镜展示真实产品选择页面。不得用虚假的复杂 HUD 误导用户；按钮文案、选择反馈和产品实际体验必须一致。

---

## 7. 静态图动效与剪辑规范

每张图只需要四类低成本动效：

1. 2 秒内从 100% 缓慢推进到 104%—105%；
2. 人物与背景做 8—16px 反向位移形成轻微视差；
3. 使用柱子、旗帜、光影或人群剪影作为前景；
4. 字幕分两次出现，避免整段同时压上屏幕。

不要依赖复杂转场。固定音频时间点：

- 0.0s：低沉冲击；
- 1.8s：短暂静音或心跳；
- 3.2s：倒带音；
- 5.0s：音乐重新进入；
- 10.2s：UI 展开；
- 13.6s：选择点击；
- 14.5/16.1/17.7s：三次后果重音；
- 19.8s：音乐抬升；
- 23.0s：现有 Logo 品牌音。

---

## 8. 仓库工具使用

进入：

```bash
cd marketing/video-kit
```

运行测试：

```bash
npm test
```

校验全部示例：

```bash
npm run validate
```

批量生成：

```bash
npm run generate
```

单条生成：

```bash
node scripts/video-kit.mjs generate \
  examples/caesar-brutus-fate.json \
  generated/caesar-brutus-fate
```

输出包括：

```text
frames/01-hook.svg ... frames/10-logo.svg
contact-sheet.svg
storyboard.md
subtitles.srt
edit-decision-list.csv
asset-checklist.md
manifest.json
```

`manifest.json` 记录源 JSON SHA-256、输出文件 SHA-256、场次数、总时长和警告，用于确认分镜是否来自当前版本源数据。

---

## 9. 首批创意不是二十条换皮

首批应测试五种用户欲望，每种做两个版本：

| 方向 | A | B |
|---|---|---|
| 改变历史 | Can you save Caesar? | Caesar survived. Rome did not. |
| 角色代入 | You are Brutus. | Would you betray the man who trusts you? |
| 多人因果 | One choice changed three players. | Brutus lied. Everyone changed their plan. |
| 意外结局 | Five players saved Caesar. | Five players accidentally started a civil war. |
| 观众选择 | Warn / Join / Deceive | Who should Caesar trust? |

可以复用人物图、字体、UI、音效和 Logo，但每条至少改变三项：前三秒钩子、心理冲突、叙事视角、是否揭晓结果、主卖点、结尾问题或 CTA。删除人物姓名后仍完全相同的两条，不算两个创意。

---

## 10. 落地链路

视频深链示例：

```text
/worlds/caesar?mode=solo&role=brutus
&utm_source=short_video
&utm_campaign=caesar_mvp
&utm_content=caesar_brutus_fate
```

页面第一屏直接继续视频中的危局：

```text
You are Brutus.
Caesar will enter the Senate soon.
What do you do?
```

推荐链路：视频 → 对应角色危局 → 第一次选择 → 第一个可见后果 → 注册或继续。不要先跳首页、重新选世界、重新理解产品。

---

## 11. 数据与迭代

播放量不是唯一指标。每条视频记录：

- 2 秒与 3 秒留存［
- 平均观看时长［
- 完播率、重播率、评论与分享［
- 主页访问和链接点击［
- 落地页加载成功［
- 第一次选择开始与完成［
- 第一次后果看见［
- 注册、开房和邀请。

MVP 北极星指标：

> 每 1000 次视频播放，产生多少名完成第一次有效选择的用户。

首发十条后，保留转化最强的两个创意方向，各追加 3—5 个真正不同的变体；评论高但不转化的内容可以承担互动，不承担获客预算。

---

## 12. 质量验收

### 文案

- 前三秒有命运问题；
- 5—7 秒完成角色身份；
- 三项选择代表不同策略；
- 每项尽量不超过四个英文单词；
- 三个后果都是具体事件；
- 产品说明不超过三行；
- CTA 只有一个。

### 视觉

- 9:16，字幕在安全区；
- 背景不过暗，文字清楚；
- 人物一致，不发生漂移；
- 至少一镜展示真实或忠实复刻 UI；
- 危机表达非血腥；
- Logo 使用现有版本。

### 技术

```bash
npm test
npm run validate
npm run generate
```

全部通过；十段时间总和与 JSON 一致；SRT、CSV、SVG、Markdown、manifest 均能生成；错误选择数、错误时长和不安全视觉描述会被拒绝。

---

## 13. MVP 后续自动化路线

P0：JSON → 分镜、字幕、剪辑表；人工准备正式图片并在剪辑软件中完成 MP4。

P1：加入 FFmpeg、Ken Burns 动效、SRT 烧录、音效时间线和 Logo 自动拼接，一键导出 9:16 母版。

P2：从已结算的真实游戏事件生成 JSON。AI 只压缩文案和选择模板，不得自行发明玩家因果。

P3：创意实验系统自动写入 UTM、回收转化数据，并按照“第一次有效选择成本”淘汰弱方向。

---

## 14. 最终执行原则

```text
先用命运终点让用户停下来；
再用角色身份让用户承担责任；
用无法两全的选择让用户开始思考；
用三个连锁后果证明产品差异；
最后用一个角色 CTA 让用户直接开始玩。
```

固定的是 27 秒生产合同、品牌视觉、UI、音效、校验和输出格式；持续变化的是观看理由、角色心理、选择、跨玩家后果和真实结局。这样才能低成本批量生产，而不是把同一条广告换二十次名字。
