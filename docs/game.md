# 《Word Spire · 词塔》游戏设计文档(草稿)

> **状态**:设计草稿,待你审阅与修改。
> 这是从 `docs/PLAN.md` 抽出的独立游戏设计。数值、命名、节奏都可改——见 §1 的「待拍板清单」。
> **暂定名**:Word Spire(词塔)。名字可改。
>
> 一句话:一款**简化版《杀戮尖塔》**。你**回忆学过的单词**来构筑一副带随机强力能力的牌库,爬一座 7 层小塔、击败 Boss「遗忘」。记得越牢的词,卡越强;一局游戏本身就是一轮 FSRS 复习。

---

## 1. 待你拍板的清单(改这里最省事)

这些是需要你决定或最可能想调的点,按重要性排序。其余章节是细节。

| # | 决策点 | 目前草案 | 备选 / 说明 |
|---|---|---|---|
| A | **游戏名 / 中文名** | Word Spire / 词塔 | 随便改;卡牌译名(§6 表)也可一并改 |
| B | **一局时长** | 15–25 分钟(7 层、约 7 场战斗) | 想更短→5 层;更长→2 幕 |
| C | **开局门槛** | 需 ≥ 20 个已学词 | 太高→改 10;太低→改 30 |
| D | **精通档加成幅度** | +0/10/20/30%(T0–T3) | 想让"记得牢"更爽→加大;想弱化学习门槛→缩小 |
| E | **战斗内快答**(打稀有卡弹 3.5 秒选义) | 开启,答错效果减半 | 觉得打断心流→关掉,只保留"战后领卡"回忆 |
| F | **FSRS 评分是否写回** | 默认写回(可开局关) | 是否让游戏影响真实复习排程 |
| G | **玩家最大 HP / 每回合能量** | 60 HP / 3 能量 / 抽 5 | 战斗手感的总旋钮 |
| H | **视觉基调** | 简洁 + 羊皮纸底 + 几何 SVG 敌人 | 你已定:先简洁,奥数魔法学院风等有美术再上 |
| I | **卡池规模 / 敌人数量** | 28 张模板 / 9 种敌人(含 2 精英 1 Boss) | v1 想更小可砍到 ~16 张 / 6 敌人 |

> 标注 **〔可调〕** 的数字都是平衡旋钮,实现时会集中放在后端 `services/game/balance.py`,改一处即可。

---

## 2. 设计支柱

- **单词即卡牌**:每张卡绑定一个你学过的单词,卡面主标题就是那个英文单词,下面钉一行小号中文释义(这就是"学习面")。
- **回忆即获取**:要得到一张卡,得先答对它单词的释义选择题;答错也不是一无所获(拿到"钝化版"),但会被记一次 FSRS「Again」。
- **精通即强度**:FSRS 的记忆稳定度(stability)映射"精通档",记得越牢的词,卡的数值越高——**复习行为直接变成战斗力**。
- **游戏即复习**:词池优先取到期该复习的词,打一局游戏 = 变相刷了一轮复习;结果按保守规则写回 FSRS。
- **视觉克制**:沿用现有设计语言(圆角、软阴影),游戏面加一层暖色羊皮纸底 + 稀有度描边色 + 几何 SVG 敌人 + 细腻 CSS 待机动画。**零图片素材依赖**。

---

## 3. 核心循环(玩家视角)

```
选词书(或"全部") → 后端生成:词池 + 初始牌组 + 一张种子地图
   → 在 13 节点的小地图上,自选路径走 7 层(战斗 / 精英 / 休整 / 事件)
   → 每场战斗胜利 → 三选一卡牌奖励(答对该卡单词的释义选择题才能足额入手)
   → 第 6 层固定「休整」(回血 或 研读复习)
   → 第 7 层 Boss「遗忘 The Forgetting」
   → 胜利 / 败北结算:到达层数、战绩、回忆词数与正确率、本局 FSRS 更新清单
```

- **肉鸽**:HP 归零即本局结束,从头再来(牌库、地图、词都重掷)。
- 同一时刻**至多一个活跃局**,可在**节点粒度**断点续玩(战斗中崩溃则以进入该节点时的血量重开这一节点)。

---

## 4. 单词 ↔ 卡牌

### 4.1 词池与开局门槛

- **词池** = 你已学的词(`fsrs_state > 0` 且有中文释义),**到期该复习的排最前**,再用随机已学词补足,上限 80 个。〔可调:80〕
- **开局需 ≥ 20 个已学词**〔可调〕。不足时游戏首页显示进度条并引导你先去每日学习。
- 一个词在一局内至多绑定一张卡(生成候选时排除牌库已有的词)。

### 4.2 精通档(tier)—— 记得越牢越强

由该词的 FSRS 稳定度 S(单位:天)决定档位:

| 档 | 条件 | 数值加成 |
|---|---|---|
| T0 | S < 2(刚学/记不牢) | +0% |
| T1 | 2 ≤ S < 10 | +10% |
| T2 | 10 ≤ S < 30 | +20% |
| T3 | S ≥ 30(烂熟) | +30%,卡面带闪箔描边 |

- 所有伤害 / 格挡 / 治疗数值按 `ceil(基础 × (1 + 0.1 × 档))` 放大。
- **稀有度不看稳定度**——词汇量弱的玩家一样能抽到稀有卡;精通只体现在这个档位加成上。**保证弱词池能玩、强词池有明显收益。**〔可调:档位边界与 10% 步长〕

### 4.3 稀有度与领卡

- **稀有度**:普通(C)/ 优秀(U)/ 稀有(R)。三选一奖励的稀有度权重:
  - 普通战 **60 / 32 / 8**,精英战 **40 / 42 / 18**,Boss 奖励 = 3 张稀有,事件另定。〔可调〕
- **领卡规则**:答对该卡单词的释义选择题 → 足额入手;答错 → 以**钝化(Dulled)**状态入手(全数值 ×0.75 向下取整、最低 1,卡面带钝化标记)。
  - 设计意图:永远有所得,保住一局的动量;真正的惩罚是那次 FSRS 的「Again」。

### 4.4 回忆机制与 FSRS 写回

识别式选择题的记忆证据比主学习流程的"输入式回忆"弱,所以**永不给 Easy**:

| 回忆场景 | 形式 | 答对 | 答错 | 超时 |
|---|---|---|---|---|
| 战后领卡 | 4 选 1,不限时(约 10s 软提示) | Good (3) | Again (1) | — |
| 战斗内快答(仅稀有卡) | 3 选 1,3.5 秒 | Good (3) | Again (1) | Hard (2) |
| 休整点「研读」 | 4 选 1,不限时 | Good (3) | Again (1) | — |

- **单词单局限记一次**:一局内同一词只有**首次**回忆写 FSRS + 复习日志,之后只影响游戏内效果——防止同一天刷分扭曲复习排程。
- 开局有 **`fsrs_enabled` 开关**(默认开)。关掉则纯娱乐、不动你的复习数据。

---

## 5. 效果指令集(卡牌与敌人共用)

后端生成完整卡对象,前端只解释一串 `ops` 效果指令(前端 `game/effects.js` 统一执行,敌我一致):

`damage{n,times,target:enemy|all,pierce}` · `block{n}` · `heal{n}` · `draw{n}` · `energy{n}` · `status{id:weak|vulnerable, n, target}` · `strength{n}` · `power{id:metallicize|ramp_strength|extra_draw, n}`

敌方专用:`discard_random{n}` · `energy_drain{n}` · `exhaust_random_discard{n}` · `mimic_last_attack{min}`

> 状态说明:**虚弱(weak)**=造成伤害 ×0.75;**易伤(vulnerable)**=受到伤害 ×1.5;**力量(strength)**=每次攻击 +n(本场平坦);均按回合数递减(力量除外)。

---

## 6. 卡牌模板表(28 张)

A=攻击 S=技能 P=能力;数值为 **T0 基础**(实际按精通档放大)。整张表都可改。

| # | 名称 | 类 | 费 | 稀有度 | 效果 |
|---|---|---|---|---|---|
| 1 | Strike 斩词 | A | 1 | 初始 | 6 伤害 |
| 2 | Guard 护盾 | S | 1 | 初始 | 5 格挡 |
| 3 | Study 研读 | S | 1 | 初始 | 抽 2 |
| 4 | Flick 轻挑 | A | 0 | C | 3 伤害 |
| 5 | Echo 回声 | A | 1 | C | 4 伤害 ×2 |
| 6 | Heavy Tome 重典 | A | 2 | C | 14 伤害 |
| 7 | Sweep 横扫 | A | 1 | C | 对全体 5 伤害 |
| 8 | Barrier 壁垒 | S | 1 | C | 7 格挡 |
| 9 | Trip 绊倒 | S | 1 | C | 易伤 2 |
| 10 | Numb 钝化 | S | 1 | C | 虚弱 2 |
| 11 | First Aid 急救 | S | 1 | C | 治疗 4,消耗 |
| 12 | Cram 突击 | S | 0 | C | +1 能量,抽 1,消耗 |
| 13 | Lexicon Lash 辞鞭 | A | 1 | U | 7 伤害 + 虚弱 1 |
| 14 | Piercing Quill 穿刺羽笔 | A | 1 | U | 9 伤害,无视格挡 |
| 15 | Chain Syllables 连音 | A | 2 | U | 对全体 7 伤害 |
| 16 | Parry 格挡反击 | A | 1 | U | 5 伤害 + 5 格挡 |
| 17 | Recite 朗诵 | P | 1 | U | 力量 +2 |
| 18 | Iron Binding 铁装订 | P | 1 | U | 每回合结束获得 2 格挡 |
| 19 | Skim 速览 | S | 0 | U | 抽 2,消耗 |
| 20 | Sap 汲取 | A | 2 | U | 8 伤害,治疗 4,消耗 |
| 21 | Ward 结界 | S | 2 | U | 14 格挡 |
| 22 | Dictionary Slam 辞典猛击 | A | 3 | U | 22 伤害 |
| 23 | Perfect Recall 完美回忆 | S | 1 | R | 抽 3,+1 能量 |
| 24 | Thesaurus Storm 词雨 | A | 3 | R | 对全体 9 伤害 + 虚弱 1 |
| 25 | Definition of Power 力量定义 | P | 2 | R | 每回合开始力量 +1 |
| 26 | Mnemonic Engine 记忆引擎 | P | 1 | R | 每回合多抽 1 张 |
| 27 | Killing Word 致命之词 | A | 2 | R | 10 伤害 + 易伤 3 |
| 28 | Total Immersion 沉浸 | S | 2 | R | 20 格挡,消耗 |

- **初始牌组(10 张)**:5× Strike + 4× Guard + 1× Study,自动绑定你**稳定度最高的 10 个词**——开局就展示"你最熟的词在为你而战"。
- **卡面元素**:左上费用圆点、英文单词大标题、下方小号中文释义、效果文本、类型图标(剑/盾/齿轮,内联 SVG)、稀有度描边(C 灰 / U 蓝 / R 琥珀)、精通档小圆点、钝化遮罩(如钝化)。

---

## 7. 战斗规则

- **玩家**:最大 HP 60〔可调〕,全局延续;每回合 3 能量〔可调〕、抽 5 张,手牌上限 10;回合末弃掉手牌;抽牌堆空则洗入弃牌堆;`exhaust` 卡本场移除。
- **回合顺序**:
  1. 玩家回合开始 → 格挡清零 → 能力结算(`extra_draw` / `ramp_strength`)→ 抽牌
  2. 出牌(逐张完整结算;打稀有卡可能触发战斗内快答浮层)
  3. 结束回合 → `metallicize` 结算 → 弃手牌
  4. 敌人按列表顺序执行**已亮出的意图** → 敌方状态倒计时 → 敌人亮出下回合意图(立即可见)
  5. 回到玩家回合
- **伤害公式**:`floor((基础 + 力量) × (虚弱? 0.75 : 1) × (目标易伤? 1.5 : 1))`,先扣格挡,余数进 HP。
- **战斗内快答**(可整体关闭,见 §1-E):打出**稀有**卡、且该词本场还没验证过时,弹出浮层——3.5 秒环形倒计时、单词居中放大、3 个 ≤16 字符的短释义、按键 1–3 或点击、背景战场压暗。答对 → 足额生效;答错/超时 → 本次数值 ×0.5(向下取整、最低 1)+"失效"动效。每场每词至多一次。回合制天然可暂停,不打断操作流。
- 玩家死亡 → 本局 `lost`;击败第 7 层 Boss → `won`。

---

## 8. 敌人图鉴

`f` = 地图层数(1–7),HP 随层数成长。意图是固定循环(种子确定),**战前可见**。全部几何 SVG + 色板着色 + CSS 待机动画,无图片。

| 敌人 | HP | 行为循环 | 造型 |
|---|---|---|---|
| Ink Blot 墨点 | 14+2f | 攻 6 → 攻 6 → 涂抹(虚弱 1) | 蠕动墨滴(SVG blob 形变) |
| Paper Wisp 纸灵 | 10+2f | 裁切 4×2 → 折叠(格挡 5) | 飘动细长纸片 |
| Stray Comma 逗号精 | 12+2f | 啃咬 3 + 易伤 1 → 攻 5 | 逗号字形,上下浮动 |
| Eraser Golem 橡皮巨人 | 24+3f | 猛砸 9 → 硬化(格挡 8) | 圆角矩形堆叠 |
| Red Pen 红笔 | 18+2f | 批改!7 → 批改!7 → 下划线(力量 +2) | 斜线笔尖三角 |
| Blot Twins 墨点双子 | 2× 墨点 75% HP | 同墨点,相位错开 | 两只墨滴 |
| **精英:The Censor 审查者** | 46+4f | 涂黑(10 伤 + 随机弃 1)→ 黑条(格挡 10 + 力量 2)→ 涂黑 | 黑色圆角横条,缓慢脉动 |
| **精英:Plagiarist 抄袭者** | 40+4f | 模仿(复制你上次攻击,下限 6)→ 偷笔记(6 伤 + 吸 1 能量) | 玩家面板的虚线复制体 |
| **Boss:The Forgetting 遗忘** | 140 | 迷雾(虚弱 2 + 格挡 12)→ 抹除(14 伤)→ 湮灭(8 伤 ×2 + 弃牌堆随机消耗 1);HP<50% 后每回合额外力量 +1 | 大型柔和渐变圆,缓慢呼吸模糊 |

**遭遇表**:第 1 层单体 {墨点/纸灵/逗号精};2–3 层单体 {橡皮巨人/红笔} 或双体 {2×纸灵、墨点+逗号精};4–5 层强化双体 {红笔+纸灵、墨点双子} 或单体橡皮巨人;精英节点出精英;第 7 层 Boss。

---

## 9. 地图

- **层结构**:R1 战斗×1(入口)· R2×2 · R3×3 · R4×3 · R5×2 · R6 休整×1 · R7 Boss×1 = **13 节点**,单局经过 7 个。
- **节点类型分配**:R2–R5 的 10 个自由槽里,恰好 1 个精英(均匀落在 R3–R5);其余 9 个按 战斗 0.62 / 事件 0.23 / 休整 0.15 加权,并保证每图 ≥1 事件。〔可调〕
- **连边**(不交叉、全可达):相邻两层用双指针扫描连边,再每图加 1 条随机平行边增加选择密度;构造上保证每节点出入度 ≥1、路径不交叉。
- **渲染**:单个内联 SVG,节点是带类型字形的圆,已走路径高亮、可去的下一节点脉动;7 层无需滚动。
- **随机数**:后端 `random.Random(f"{seed}:{用途}")` 决定一切结果(可复现、可单测、防"重开刷奖励");前端随机只用于洗牌动画等观赏效果,从不决定结果。

---

## 10. 节点类型

- **战斗 / 精英**:战胜 → 三选一领卡(经释义选择题,可跳过);精英战后额外回 3 HP。
- **休整(R6 固定)**:二选一 —— **休息**(回 30% 最大 HP)或 **研读**(至多 3 道回忆题,到期词优先;每答对随机把一张可升档的卡 +1 档,上限 T3;答错无额外惩罚)。研读复用战斗内快答的浮层组件,低成本加深复习闭环。
- **事件(神秘)** v1 共 4 个:
  - **游学者**:连对 2 题 → 从 3 张 U+ 卡中选 1;有错则空手。
  - **旧词典**:失 6 HP → 得一张随机稀有卡(可跳过)。
  - **静泉**:回 15% 最大 HP **或** 删掉一张牌(二选一)。
  - **记忆之镜**:复制你选的一张牌。
- **Boss(R7)**:战斗 → 胜利结算。

---

## 11. 结算与持久化

- **存档时机**:开局 + 每个节点完成时(不做战斗中存档)。
- **结算屏**:结果(胜/败)、到达层数、战斗场数、回忆词数与正确率、本局 FSRS 更新的词清单——视觉语言对齐现有的"学习会话完成"页。
- 历史保存最近若干局的摘要(层数、战绩、正确率),游戏首页可查。

---

## 12. v1 范围 / v2 扩展

**v1 明确不做**(为按时收敛):金币/商店、遗物、药水、档位之外的卡牌升级、多幕、战斗中存档。

**v2 候选**:遗物系统(绑"词根/词缀"主题)、商店与货币、药水、多幕多 Boss、卡牌升级树、每日挑战(固定种子排行)、听力回忆模式(播放发音选义)、词书专属敌人皮肤、接入真实美术素材替换几何 SVG。

---

## 附录 A. 数据库(迁移 v10,支撑游戏)

新增两张表(`review_log` 让整个 app 都受益;`game_runs` 存局):

```sql
CREATE TABLE IF NOT EXISTS review_log (
    log_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id         INTEGER NOT NULL REFERENCES Words(word_id) ON DELETE CASCADE,
    reviewed_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
    source          TEXT    NOT NULL DEFAULT 'session' CHECK (source IN ('session','game')),
    elapsed_ms      INTEGER,
    stability_after REAL,
    state_after     INTEGER
);

CREATE TABLE IF NOT EXISTS game_runs (
    run_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    status         TEXT    NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','won','lost','abandoned')),
    book_name      TEXT,
    seed           INTEGER NOT NULL,
    fsrs_enabled   INTEGER NOT NULL DEFAULT 1,
    state_json     TEXT    NOT NULL,           -- 完整局面,用于断点续玩
    floor_reached  INTEGER NOT NULL DEFAULT 0,
    battles_won    INTEGER NOT NULL DEFAULT 0,
    words_recalled INTEGER NOT NULL DEFAULT 0,
    recall_correct INTEGER NOT NULL DEFAULT 0,
    recall_total   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_runs_one_active
    ON game_runs(status) WHERE status = 'active';   -- 至多一个活跃局
```

`state_json` 形态:

```json
{"v":1, "seed":123456, "book":"TOEFL", "fsrs_enabled":true,
 "hp":47, "max_hp":60, "node_index":4, "path_taken":[0,2,5],
 "map":{"rows":[...],"edges":[...],"types":[...],"encounters":[...]},
 "deck":[{卡对象}],
 "recalled_words":{"abate":{"rating":3,"fsrs_applied":true}},
 "stats":{"battles_won":3,"damage_dealt":182,"recall_correct":5,"recall_total":6},
 "started_at":"2026-07-12T09:00:00Z"}
```

## 附录 B. 游戏 API(前端调用)

新增方法(均失败返回 `{"error": str}`);后端落在 `services/game/`:

| 方法 | 返回 |
|---|---|
| `game_get_status(book_name)` | `{learned_count, min_required:20, eligible, active_run:{...}\|null, history:[近10局]}` |
| `game_start_run(book_name, fsrs_enabled=True)` | `{run_id, state}`(建词池/初始牌组/地图) |
| `game_get_active_run()` | `{run_id, state}` 或 `{none:true}` |
| `game_save_run(run_id, state)` | `{ok}` |
| `game_get_card_offers(run_id, node_index, context)` | `{offers:[卡×3]}`,按 `(seed,node,context,牌组词集)` 确定性生成 |
| `game_record_recall(run_id, word, outcome, context, elapsed_ms)` | `{fsrs_applied, rating}`,强制单词单局限记一次 |
| `game_end_run(run_id, status, stats)` | `{ok, summary}` |
| `game_get_run_history(limit=10)` | `[{run_id,status,book,floor_reached,battles_won,recall_accuracy,ended_at}]` |

## 附录 C. 实现落点(重构已留好的接缝)

- 前端:`gui/web/js/game/`(新建,与 `views/` 平级),`css/game.css`(已占位),游戏入口回到 Home 页(已留注释占位)。
- 后端:`services/game/{service,cards,mapgen,balance}.py`(新建),`db/{review_repo,run_repo}.py`(新建),`db/connection.py` 升 v10。
- 平衡数值集中在 `services/game/balance.py`,便于按本文 §1 的旋钮统一调。
