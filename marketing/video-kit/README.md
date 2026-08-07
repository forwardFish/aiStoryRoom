# Our Many Worlds MVP Short Video Kit

这是一个**不依赖第三方 npm 包**的短视频生产工具包，用于把一份可替换的剧情 JSON 转换为：

- 10 镜头 SVG 分镜图；
- 一张完整联系表 `contact-sheet.svg`；
- 剪辑分镜文档 `storyboard.md`；
- 字幕文件 `subtitles.srt`；
- 剪辑决策表 `edit-decision-list.csv`；
- 素材清单 `asset-checklist.md`；
- 带哈希的生成清单 `manifest.json`。

它不会直接渲染最终 MP4，也不会替代剪映、CapCut、Premiere 或 After Effects。它解决的是 MVP 阶段更实际的问题：

> 固定剪辑结构，只换人物、场景、冲突、选择和后果，就能快速得到一套可执行的新视频生产包。

## 固定母版

```text
命运终点
→ 向观众挑战
→ 时间倒带
→ 进入角色
→ 无法两全的冲突
→ 三个选择
→ 选择确认
→ 三个连锁后果
→ 一句话解释产品
→ 现有 Logo 视频
```

默认成片规格：

- 9:16；
- 1080 × 1920；
- 24fps；
- 27 秒；
- 前 3.2 秒完成钩子；
- 至少一镜展示真实或忠实复刻的游戏选择 UI；
- 后果必须写成具体人物与世界变化，而不是抽象数值。

## 快速开始

在本目录执行：

```bash
npm test
npm run validate
npm run generate
```

或者不通过 npm：

```bash
node scripts/video-kit.mjs validate examples
node scripts/video-kit.mjs generate examples/caesar-brutus-fate.json generated/caesar-brutus-fate
node scripts/video-kit.mjs batch examples generated
```

## 目录

```text
marketing/video-kit/
├── README.md
├── package.json
├── schema/
│   └── video-spec.schema.json
├── examples/
│   ├── caesar-brutus-fate.json
│   ├── caesar-caesar-warning.json
│   └── sangtian-governor-crisis.json
├── prompts/
│   └── visual-generation-prompts.md
├── scripts/
│   └── video-kit.mjs
├── tests/
│   └── video-kit.test.mjs
└── generated/
    └── <videoId>/
        ├── frames/*.svg
        ├── contact-sheet.svg
        ├── storyboard.md
        ├── subtitles.srt
        ├── edit-decision-list.csv
        ├── asset-checklist.md
        └── manifest.json
```

## 生成一条新视频

### 1. 复制示例

```bash
cp examples/caesar-brutus-fate.json examples/hamlet-ghost-warning.json
```

### 2. 只替换剧情合同

至少替换：

- `videoId`；
- `world`；
- `hook`；
- `player`；
- `conflict`；
- 三个 `choices`；
- `selectedChoiceId`；
- 三个 `consequences`；
- `worldResult`；
- `assets`；
- `publish.landingPath`。

### 3. 校验

```bash
node scripts/video-kit.mjs validate examples/hamlet-ghost-warning.json
```

校验器会阻止：

- 时长和镜头时长不一致；
- 不是三个选择；
- 选中的 ID 不存在；
- 不是三个跨角色后果；
- 字幕明显超长；
- 颜色或路径合同缺失；
- 视觉描述包含明显不适合广告平台的血腥表达。

### 4. 生成

```bash
node scripts/video-kit.mjs generate \
  examples/hamlet-ghost-warning.json \
  generated/hamlet-ghost-warning
```

### 5. 在剪辑软件中替捂�
按 `asset-checklist.md` 准备正式素材，用人物图、剧情图、真实 UI 和现有 Logo 视频替换 SVG 示意图。字幕与时间轴可直接参考 SRT 和 CSV。

## SVG 的定位

生成的 SVG 是：

- 分镜；
- 构图说明；
- 字幕安全区说明；
- 临时占位图；
- 团队沟通和外包验收依据。

它们不是最终营销美术。正式成片仍应使用：

- 统一风格的人物图；
- 明亮、低对比、留有文字空间的场景图；
- 产品真实 UI；
- 现有 Logo 视频；
- 已确认授权的音乐和音效。

## 创意不要只做换皮

复用的是生产系统，不是观看内容。建议首批按照五种心理方向各做两个版本：

1. 改变历史；
2. 成为历史人物；
3. 一个决定改变其他玩家；
4. 真实玩家制造意外结局；
5. 让观众先做选择。

固定品牌、字体、UI、音效和 Logo；变化前 3 秒钩子、角色心理问题、叙事视角、结果揭晓方式和 CTA。

## 验收命令

```bash
npm test
npm run validate
npm run generate
```

当前测试覆盖：

- 三个示例合同；
- 固定十镜头与精确总时长；
- SVG、SRT、CSV、Markdown 和 manifest 输出；
- 错误选择与错误时长的 fail-closed；
- 非血腥视觉合同；
- 源数据变更后的哈希变化。
