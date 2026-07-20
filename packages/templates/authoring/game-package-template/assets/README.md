# 游戏图片目录

请用真实图片替换下列固定文件名：

```text
assets/
├── cover.png          大厅卡片和详情页封面
├── background.png     Solo、多人房间和游戏场景背景
├── world-actor.png    世界规则角色图片
└── roles/
    ├── role-01.png
    ├── role-02.png
    ├── role-03.png
    ├── role-04.png
    ├── role-05.png
    └── role-06.png
```

如果角色数不是 6，可增加或删除 `roles/` 图片，并同步修改 `game.json.roles` 与 `maxHumanPlayers`。

发布时整个目录复制到：

```text
apps/web/public/assets/game/<worldId>/
```
