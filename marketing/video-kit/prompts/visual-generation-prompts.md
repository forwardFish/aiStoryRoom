# Our Many Worlds 短视频视觉素材提示词包

本文件用于生成或外包制作短视频静态素材。目标不是电影海报，而是**能承载字幕、能快速识别人物关系、能在 9:16 中稳定复用**的剧情画面。

## 一、统一视觉锁定

每个世界先固定一段 Style Lock，后续所有人物与场景都重复使用。

### 凯撒世界 Style Lock

```text
Premium historical editorial illustration for a modern interactive strategy game, late Roman Republic, bright pale marble and warm daylight, restrained cinematic realism, elegant ivory and muted imperial red, soft violet brand accents, clean readable silhouettes, subtle depth, high-end magazine composition, generous negative space for captions, vertical 9:16, consistent character identity and costume across all images, no fantasy armor, no modern objects, no dark horror grading, no graphic injury, no gore, no text, no logo.
```

### 桑田诏世界 Style Lock

```text
Premium historical political-drama editorial illustration, Ming dynasty provincial administration, pale paper, warm ivory walls, muted ink, restrained purple brand accents, ledgers, seals and official documents as visual symbols, bright low-contrast atmosphere, controlled realistic expressions, generous negative space for captions, vertical 9:16, consistent character identity and costume, no fantasy elements, no modern objects, no text, no logo.
```

## 二、凯撒母版所需素材

### 01 Hook：凯撒命运终点

文件名：`01-hook-fate.png`

```text
[CAESAR STYLE LOCK]
Inside the Roman Senate immediately after a historic political crisis, a fallen laurel wreath in the foreground, senators frozen in shock as clean silhouettes, Caesar mostly obscured by robes and marble steps, Brutus visible at a distance with conflicted posture, symbolic aftermath rather than action, strong central negative space for the caption “CAESAR IS DEAD”, readable in less than one second, non-graphic, no visible wound, no blood, no weapon close-up.
```

构图要求：

- 重点是“命运已发生”，不是伤口；
- 桂冠、元老院、人物关系三者至少出现两个；
- 上方或中下方保留 35% 字幕空间；
- 背景不可太暗。

### 02 Rewind A：危机定格

```text
[CAESAR STYLE LOCK]
The Roman Senate frozen at the instant before a political crisis, senators leaning inward, Caesar turning slightly, marble chamber and pale daylight, visual tension without physical violence, same camera axis and character continuity as the hook image, vertical 9:16, motion-ready composition, no text.
```

### 03 Rewind B：凯撒重新站起

```text
[CAESAR STYLE LOCK]
Caesar standing again on the Senate steps as the surrounding senators move backward in a surreal but restrained rewind impression, trailing robes and drifting dust indicating reversed time, same camera axis, bright marble, no injury, no text.
```

### 04 Rewind C：凯旋起点

```text
[CAESAR STYLE LOCK]
Caesar entering Rome before the crisis, welcomed by a large crowd beneath banners and pale daylight, admired but politically imposing, broad vertical composition, clear negative space for captions, same Caesar identity and costume as all other images, no text.
```

### 05 Player Role：布鲁图斯

文件名：`brutus.png`，建议透明 PNG。

```text
[CAESAR STYLE LOCK]
Chest-up portrait of Brutus alone in a bright marble corridor, holding an unopened sealed letter, divided light across his face suggesting loyalty and doubt, intelligent restrained expression, historically grounded Roman clothing, isolated clean silhouette, transparent background if supported, no text.
```

### 06 Conflict A：凯撒

```text
[CAESAR STYLE LOCK]
Chest-up portrait of Caesar, calm, charismatic and trusting, pale daylight, laurel wreath understated, historically grounded clothing, clean silhouette, transparent background if supported, no text.
```

### 07 Conflict B：卡西乌斯

```text
[CAESAR STYLE LOCK]
Chest-up portrait of Cassius, controlled intensity, persuasive rather than villainous, historically grounded Roman clothing, slightly sharper side light, clean silhouette, transparent background if supported, no text.
```

### 08 Consequence：安东尼

```text
[CAESAR STYLE LOCK]
Chest-up portrait of Mark Antony receiving urgent political information, alert and decisive, historically grounded Roman clothing, clean silhouette, transparent background if supported, no weapon emphasis, no text.
```

### 09 World：罗马与元老院

```text
[CAESAR STYLE LOCK]
Bright panoramic Roman Forum and Senate approach adapted to vertical 9:16, pale stone, restrained crowds, visible political center, upper and lower negative space for UI overlays, no main character close-up, no text.
```

## 三、角色一致性表

正式生成前先建立角色参考表：

| 角色 | 必须锁定 | 不可漂移 |
|---|---|---|
| Caesar | 年龄、脸型、发色、桂冠、白/红衣纹 | 不同镜头突然年轻或换铠甲 |
| Brutus | 年龄、短发、鼻梁、素色衣、密信 | 不可变成刺客化反派 |
| Cassius | 消瘦轮廓、锐利眼神、深色衣 | 不可夸张邪恶表情 |
| Antony | 更强健轮廓、军政气质 | 不可变成全副战斗装束 |

推荐先生成一张“角色设定联系表”，人工确认后再生产剧情图。

## 四、UI 素材要求

选择镜头优先截取真实产品 UI。无法直接录屏时，简化复刻必须保留：

- 浅色底；
- 紫色品牌选中态；
- 三个清晰选项；
- 一眼能看懂哪个选项被点击；
- 不展示与视频无关的复杂状态；
- 不伪造产品尚不存在的功能。

建议画面文字：

```text
WHAT WOULD YOU DO?

WARN CAESAR
JOIN CASSIUS
DECEIVE THEM BOTH
```

## 五、负面约束

每个生成提示词末尾统一追加：

```text
Negative: dark horror lighting, gore, graphic injury, visible blood, weapon close-up, fantasy armor, inaccurate medieval clothing, modern city, modern typography, watermark, logo, generated text, duplicated people, extra limbs, inconsistent face, oversaturated orange and teal, black background, unreadable composition.
```

## 六、素材验收

每张图逐项检查：

- 0.5 秒内是否知道主角是谁、发生了什么；
- 9:16 裁切后人物是否完整；
- 字幕区是否有足够留白；
- 与其他人物图的画风和光线是否一致；
- 是否明亮到能承载白色或深色字幕；
- 是否存在生成文字、Logo、水印或历史错位；
- 钩子是否强，但仍保持非血腥、可投放；
- 人物是否像政治参与者，而不是简单善恶标签。

## 七、新世界替换公式

```text
Style Lock
+ 世界时间地点
+ 当前镜头功能
+ 主体人物与关系
+ 可见命运压力
+ 9:16 与字幕留白
+ 一致性要求
+ 负面约束
```

不要只把“Caesar”替换成“Hamlet”。每个世界必须先重新定义：

- 最容易被看懂的命运终点；
- 玩家身份；
- 无法两全的关系；
- 三个不同策略；
- 三个可以画出来的后果；
- 世界独有的视觉符号。
