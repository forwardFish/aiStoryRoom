# 可复制游戏内容包模板

这是 MVP 阶段的新游戏作者源目录。复制整个目录后，只修改本目录中的 JSON、剧本文字和图片；不要复制页面代码。

## 复制方法

```powershell
Copy-Item -Recurse `
  packages/templates/authoring/game-package-template `
  packages/templates/authoring/<worldId>
```

复制后，全局替换以下占位值：

- `template_world`：稳定的英文小写游戏 ID，例如 `caesar`。
- `template_world_v1_0`：本次剧本内容版本。
- `template_world_actor`：规则控制的世界角色；它不占玩家席位。
- `template_role_01` 至 `template_role_06`：玩家角色 ID。

## 固定目录合同

```text
<worldId>/
├── game.json
├── strategy-registry.json
├── continuous-strategy/
│   ├── README.md
│   ├── manifest.json
│   ├── stages.json
│   ├── role-stage-content.json
│   ├── maneuver-strategies.json
│   ├── reaction-scenarios.json
│   ├── system-actions.json
│   ├── agent-policies.json
│   ├── result-rules.json
│   ├── ending-rules.json
│   └── schemas/
└── assets/
    ├── README.md
    └── roles/
```

## 发布映射

作者源保持在一个目录中；发布时复制到当前运行时要求的两个位置：

```text
game.json + strategy-registry.json + continuous-strategy/
  -> packages/templates/config/<worldId>/

assets/
  -> apps/web/public/assets/game/<worldId>/
```

然后只在 `packages/templates/config/game-registry.json` 增加一个注册项。页面不应该增加任何 `<worldId>` 专属代码。

## 安全状态

模板默认使用 `"status": "hidden"`，占位内容和图片未补齐前不会出现在页面。完成全部 JSON、图片、Manifest 哈希和验证后，再改为 `"playable"`。

`manifest.json` 与 `strategy-registry.json` 中的 64 位零哈希只是占位符，不能用于发布。发布工具必须根据最终文件重新计算哈希。
