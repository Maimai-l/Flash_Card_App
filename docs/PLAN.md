# FlashCard App 架构重构 + 卡牌游戏《Word Spire · 词塔》总体规划

> 状态:重构进行中(Phase 0–2 已完成并推送;Phase 3 前端拆分进行中);游戏 Phase 4–6 待细化设计
> 分支:`claude/card-game-architecture-plan-sve02s`
> 日期:2026-07-12

---

## 0. 实施进度

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 开发/验证基建 | ✅ 完成 | `FLASHCARD_USER_DATA` 覆盖、无窗模式、`gui/dev_bridge.py`、pytest 夹具 + Playwright e2e(`tests/e2e/run.sh`) |
| Phase 1 移除旧游戏与死代码 | ✅ 完成 | 删约 2,400 行(6 游戏 + Unity 桥 + 死代码);顺带修 `_detect_actual_version` 游标越界 bug |
| Phase 2 后端分层 | ✅ 完成 | `api(门面) → services/ → db/(仓储)`;拆掉 778 行上帝对象;SQL 收敛;修日历初始化 bug + 改名;`data/` 净化为纯资产 |
| Phase 3 前端 ES modules 拆分 | ✅ 完成 | `app.js`(1978 行)拆为 `js/core`(6)+ `js/views`(5)+ `main.js`,CSS 分 4 文件;52 个内联 on* 全部改为 data-action 事件委托;`PS` 迁至 `store.PS`。行为经 e2e 网 + 机械审计 + 对抗式审查(5 维 finder→逐条独立复核,0 确认分歧)三重验证等价 |
| Phase 4–6 游戏(后端/前端/内容) | ⏸ 待细化 | 游戏细节需再规划后实施(见 §4);重构已为其留好接缝(路由注册表、`store` 状态、`services/game/` 目录位、`css/game.css` 占位) |

**重构部分(Phase 0–3)已全部完成、验证并推送。** 游戏部分(Phase 4–6)待游戏细节规划确定后实施。

验证基建:`python3 -m pytest tests/`(16 项)+ `bash tests/e2e/run.sh`(冒烟 + 交互:导航/背单词会话/答题/导入/设置持久化)。

---

## 1. 背景与目标

当前项目(约 9,100 行)存在三类问题:**架构混乱**(前端单文件巨石、后端上帝对象、数据访问四种风格并存)、**大量死代码**(约 2,400+ 行:6 个旧小游戏中 5 个被禁用、整套无用的 Unity 桥接、废弃的 JSON 列表生成子系统)、**现有小游戏质量低**(仅翻牌配对可玩,学习价值和游戏性都弱)。

本规划的目标:

1. **全面重构**:前端拆分为 ES modules,后端按「API 门面 → 服务层 → 仓储层」分层,删除全部死代码。
2. **移除全部旧游戏**(含 Unity 基建),不迁移、不保留。
3. **新建高质量卡牌战斗游戏《Word Spire · 词塔》**(暂定名):简化版 Slay the Spire——通过**回忆学过的单词**构筑牌库(卡牌带随机强力能力),爬一座 7 层小塔,击败 Boss。学习(FSRS 复习)与游戏性(肉鸽卡牌构筑)双循环咬合。
4. **视觉方向**(用户已确认):简洁干净、配色稍活泼但不艳俗、装饰克制(轻微羊皮纸底色、阴影即可),**纯 CSS/SVG 实现、零美术素材依赖**。复杂美术风格留待将来有素材时再做。

---

## 2. 现状诊断(已由三路代码勘探核实)

### 2.1 架构问题

| 位置 | 问题 |
|---|---|
| `gui/web/app.js` | **3,154 行单文件**,约 135 个全局函数,130 处 `innerHTML`/`onclick` 拼接,`S`/`PS`/`GS` 三个全局状态对象 + 约 10 个游离 `let` 变量,无模块、无组件边界 |
| `gui/library.py` | **840 行上帝对象**,混杂 8 种职责(app_info、导入、死掉的列表生成、书籍查询、FSRS 会话读取、重置、日历…);`_to_dict` 逐字复制 **4 份**;按书过滤的 SQL 分支重复 5 处 |
| 数据访问 | **4 种风格并存**:仓储类(`word_repo`/`book_repo`)+ `library.py` 内裸 `sqlite3`(7 个方法)+ `api.py.lookup_words` 内裸 SQL + `fsrs_system.py` 内裸 SQL |
| `gui/api.py` | 673 行、38 个方法、9 类职责;每个方法重复同一套 `try/except → {"error": str(e)}` 样板 |
| `data/` 目录 | **代码与数据混放**(`.py` + 种子库 + JSON),导致 `ensure_user_data_seeded()` 把源代码复制进用户数据目录 |
| `main.py` | `game_service` ↔ `ws_server` 循环引用靠属性回填打通 |
| 杂项 | 版本号四处分叉(`APP_VERSION`/`BUNDLE_SEED_VERSION`/`SCHEMA_VERSION`/README);"calender" 拼写错误贯穿前后端;README 与实际严重漂移 |

### 2.2 死代码清单(全部删除)

| 目标 | 规模 | 说明 |
|---|---|---|
| `gui/game_service.py` | 502 行 | 6 游戏注册表 + 会话管理 + Unity 子进程启动器 |
| `data/game_ws_server.py` | 256 行 | Unity 用 WebSocket 服务器(18766 端口),Unity 资产根本不存在 |
| `app.js` 2109–3142 | ~1,035 行 | 6 个游戏的渲染器(5 个被 `ENABLED_GAMES=['card_match']` 硬禁用) |
| `app.js` 散布集成点 | ~150 行 | 状态字段、路由分支、Home 按钮、会话完成后的翻牌入口、调试面板、设置页 FSRS 边界 |
| `data/db/list_generator.py` | 193 行 | 整文件死代码,引用 v5 迁移前的列名,一跑就崩 |
| `library.py` 列表生成方法 | ~55 行 | `generate_new_list_from_book` 等 6 个方法,零调用点 |
| `word_repo.py` | ~220 行 | `import_from_vocab_list`、`get_database_stats`(查询已删除的列)、`import_fsrs_data`(仅被死代码调用) |
| `data/db/models.py` | 29 行 | 数据类仅被 `__init__.py` 导出,无实际使用 |
| `style.css` 游戏样式 | ~130 行 | 743–769(字母拼写)、801–904(翻牌);**保留** `.mcq-grid`/`.mcq-opt`(主学习流程在用)与 `.toggle-switch`(迁入组件层,新游戏设置复用) |
| 依赖 | — | `requirements.txt` 删 `websockets>=12.0`;`letmepack.spec` 删 3 条 websockets hiddenimports |

### 2.3 勘探中发现的隐藏 bug(重构时一并修复)

1. **种子数据库其实是 v1 架构**(已用 sqlite 实测:`book_identities` 列、旧列名、无 junction 表、无 `schema_version` 表)。**每次全新安装都会完整跑一遍 v1→v9 迁移阶梯**——迁移代码是活的生产路径,不是历史包袱;v10 必须正确接到阶梯末尾。
2. **迁移阶梯尾部结构问题**:`initialize_database()` 的 `version == 8` 块以 `return True` 结尾不落空;`get_schema_version()` 与 `_detect_actual_version()` 在结构探测命中 `Word_Overrides` 后直接返回 `SCHEMA_VERSION` 常量——升到 v10 时若不加 `review_log` 结构探针,v9 老库会被误报为 v10、**跳过建表**。
3. **日历初始化 bug**:`initialize_calender_info()` 写入的是 `json.dump("{}")`——一个 JSON **字符串**而非对象(仓库里的种子文件实测就是 `"{}"`)。全新安装后 `add_calender_info` 抛 `TypeError` 且被 API 层静默吞掉,**日历打卡点从来记不上**。修复 + 自愈逻辑。
4. `data/app_info.json` 种子文件是遗留格式,每次启动都靠 `renew_app_info()` 现场迁移 → 删种子文件,由服务层直接创建现代格式。
5. 未复习过的词 `difficulty` 是导入时伪造的(`min(len(vocab)/10, 1)`)——卡牌生成只能对 `fsrs_state > 0` 的词读该字段(词池本身已保证)。
6. 前端启动只挂 `pywebviewready` 事件,浏览器环境无渲染回退 → 开发桥需补显式启动路径。

---

## 3. 目标架构

### 3.1 分层原则

```
前端 (ES modules)  ──window.pywebview.api──▶  gui/api.py(唯一 JS 门面,薄)
                                                   │ 1–3 行委托
                                              services/(业务逻辑,无 SQL)
                                                   │
                                              db/(仓储层,拥有全部 SQL)
```

- `gui/api.py` 仍是 pywebview 的**单一** `js_api` 对象,但每个方法瘦身为委托调用;`@api_call(fallback=…)` 装饰器统一异常边界(**逐方法保持现有错误返回形状**,JS 依赖它们)。
- 全部 SQL 收敛进仓储层:统一的行→字典映射器干掉 4 份 `_to_dict`;一个可选书籍 JOIN 的查询构造器干掉 5 处重复分支。
- `services/context.py` 提供 `AppContext` 工厂(种子化 → 建库/迁移 → 组装仓储与服务),`main.py`、开发桥、pytest 三方共用,消灭循环引用回填。
- `data/` 变为**纯资产目录**(种子库 + seed_version),代码移出;`ensure_user_data_seeded()` 不再复制源码。
- 修正 "calender"→"calendar"(带旧文件重命名兼容);`youdao_dict.py` 移入 `scripts/`。

### 3.2 目标文件树

```
Flash_Card_App/
├── main.py                      # 启动:AppContext + HTTP 服务(+ 开发桥)+ webview 窗口
├── paths.py                     # + FLASHCARD_USER_DATA 环境变量覆盖(测试用)
├── version.py                   # 0.2.0
├── requirements.txt             # pywebview, fsrs, openpyxl
├── requirements-dev.txt         # pytest(仅开发)
├── letmepack.spec
├── gui/
│   ├── api.py                   # 唯一 js_api 门面(薄,@api_call 装饰器)
│   ├── dev_bridge.py            # POST /api JSON 桥(环境变量门控,双保险不进发行包)
│   └── web/
│       ├── index.html
│       ├── css/
│       │   ├── base.css         # 重置、:root 变量、排版
│       │   ├── components.css   # 按钮/卡片/模态/开关/吐司
│       │   ├── views.css        # 各视图样式
│       │   └── game.css         # 游戏专属主题
│       └── js/
│           ├── main.js          # 启动、pywebviewready/浏览器回退、事件委托根
│           ├── core/            # api.js  router.js  state.js  dom.js  ui.js
│           ├── views/           # home.js session.js import.js manage.js settings.js debug.js
│           └── game/            # index.js map.js battle.js cards.js effects.js enemies.js rng.js
├── services/
│   ├── context.py               # AppContext 组装工厂
│   ├── app_service.py           # app_info、日历(改名+修 bug)、软/硬重置
│   ├── study_service.py         # 每日会话、统计、due/learned/debug 词
│   ├── import_service.py        # excel/json/txt/剪贴板导入 + 词典查询
│   ├── fsrs_service.py          # record_answer(+写 review_log)← 原 data/fsrs_system.py
│   ├── update_service.py        # GitHub Release 检查 + 自更新 ← 从 api.py 抽出
│   └── game/
│       ├── service.py           # run 生命周期、回忆记录(单词单 run 限记一次)、历史
│       ├── cards.py             # 卡牌模板表、三选一生成、MCQ 选项生成
│       ├── mapgen.py            # 地图 DAG + 遭遇分配(全种子确定性)
│       └── balance.py           # 数值常量:精通档、稀有度权重、敌人成长曲线
├── db/                          # ← 由 data/db/ 移出
│   ├── connection.py            # SCHEMA_VERSION=10,阶梯 v1→v10
│   ├── word_repo.py             # + 统一查询构造器、FSRS 字段读写、搜索、游戏词池
│   ├── book_repo.py
│   ├── review_repo.py           # 新:review_log
│   └── run_repo.py              # 新:game_runs(唯一活跃 run 约束)
├── data/                        # 纯资产(首启复制到用户目录)
│   ├── database/vocabulary.db   # v1 种子库,不动
│   └── seed_version.txt
├── scripts/                     # 开发工具(不打包)
│   ├── youdao_dict.py           # ← 从根目录移入
│   ├── fetch_defs_parallel.py
│   └── fetch_missing_examples.py
├── docs/PLAN.md                 # 本文档
└── tests/
    ├── conftest.py              # 临时用户目录 + 微型 v1/v9/全新三种夹具库
    ├── test_migrations.py  test_repos.py  test_services.py
    ├── test_cardgen.py  test_mapgen.py
    └── e2e/                     # node Playwright(容器已预装 Chromium)
        ├── playwright.config.js
        ├── helpers/launch.js    # FLASHCARD_DEV_BRIDGE=1 FLASHCARD_NO_WINDOW=1 起服务
        └── specs/               # smoke / practice-session / import / settings / game-run
```

### 3.3 前端事件模型(替代 63 处内联 onclick)

模块作用域没有全局函数,全部内联 `onclick=` 必须换掉。方案:**`#app` 上一个委托 click 监听器**,按 `data-action="名字"`(参数走 `data-*`)分发到当前视图导出的 `actions` 表;input/keydown/change 等非点击事件在各视图渲染时挂载;闪卡键盘快捷键沿用现有挂载/卸载模式。路由由 switch 换成注册表 `{home, session, import, manage, settings, debug, game}`,`navigate`/`goBack` 语义不变。

**学习会话行为零改动**:`PS` 结构、`SESSION_STORE_KEY='flashcard_session_v1'`、保存/恢复/过期语义全部冻结,由 e2e 回归套件看护。

---

## 4. 新游戏设计规范 ——《Word Spire · 词塔》(暂定名)

### 4.1 设计原则

- **单词即卡牌**:每张卡绑定一个学过的单词,卡面主标题就是英文单词 + 钉一行小号中文释义(这是学习面)。
- **回忆即获取**:得卡必须先答对该词的释义选择题;答错也有惩罚性收益(见 4.4),不打断 run 的节奏。
- **精通即强度**:FSRS 稳定度(stability)映射精通档位,记得越牢的词卡越强——复习行为直接反哺战斗力。
- **游戏即复习**:词池优先取 FSRS 到期词,一局游戏就是一轮变相复习;所有回忆结果按保守映射写回 FSRS(详见 4.3),带总开关。
- **视觉克制**:现有设计语言(圆角、软阴影、:root 变量)+ 游戏面加一层暖色羊皮纸底(`#F7F3EA` 一类)、稀有度描边色、几何 SVG 敌人 + 细腻 CSS 待机动画。无图片素材。

### 4.2 核心循环

```
选词书(或全部)→ 后端生成词池 + 初始牌组 + 种子地图
→ 在 13 节点小地图上走 7 层(战斗/精英/休整/事件)
→ 战斗胜利 → 三选一卡牌奖励(答对释义 MCQ 才能足额入手)
→ 第 6 层固定休整 → 第 7 层 Boss「遗忘 The Forgetting」
→ 胜利/败北结算:层数、战绩、回忆词数与正确率、FSRS 更新清单
```

死亡即 run 结束(肉鸽);同一时刻至多一个活跃 run,可在节点粒度断点续玩。一局约 15–25 分钟。

### 4.3 词池与 FSRS 集成

- **词池**:`get_game_word_pool(book)` —— 已学词(`fsrs_state > 0` 且 `definition_zh` 非空),**到期词优先**(最久到期在前),随机已学词补足,上限 80。
- **开局门槛:≥ 20 个已学词**;不足时游戏首页显示进度并引导先去每日学习。
- 一个词一个 run 内至多绑定一张卡(生成候选时排除牌组已有词)。
- run 开始时可关 `fsrs_enabled`(默认开)。
- **评分映射**(识别式选择题的记忆证据弱于主学习流程的输入式回忆,**永不给 Easy**):

| 回忆场景 | 形式 | 答对 | 答错 | 超时 |
|---|---|---|---|---|
| 战后领卡 | 4 选 1,不限时(约 10s 软提示) | Good (3) | Again (1) | — |
| 战斗内快答(稀有卡) | 3 选 1,3.5 秒 | Good (3) | Again (1) | Hard (2) |
| 休整点「研读」 | 4 选 1,不限时 | Good (3) | Again (1) | — |

- **单词单 run 限记一次**(后端在 `game_record_recall` 强制):一个 run 内同一词只有首次回忆写 FSRS + review_log,之后只影响游戏内效果——防止同日刷分扭曲排程。

### 4.4 卡牌系统

**卡 = 模板 × 稀有度 × 单词 × 精通档。** 后端生成完整卡对象,前端只解释 `ops` 效果指令。

**卡对象**:`{cid, template_id, name, name_zh, type, cost, rarity, ops, flags:{exhaust?}, text, word, word_meaning, tier, dulled, mcq:{prompt, options[], correct_idx}}`

**精通档(tier)**由词的稳定度 S(天)决定:T0 `S<2`、T1 `2≤S<10`、T2 `10≤S<30`、T3 `S≥30`。伤害/格挡/治疗数值按 `ceil(基础 × (1 + 0.1×T))` 放大(+0/10/20/30%),T3 卡带闪箔描边。**稀有度不受稳定度门控**(词汇量弱的玩家也能见到稀有卡),精通只体现在档位加成——保证弱词池可玩、强词池有感。

**稀有度三选一权重**:普通战 60/32/8(C/U/R),精英战 40/42/18,Boss 奖励固定 3 张稀有,事件另定。

**领卡规则**:答对该卡单词的 MCQ → 足额入手;答错 → 以**钝化(Dulled)**状态入手(全数值 ×0.75 向下取整,最低 1,卡面带钝化标记)。永远有所得保住 run 的动量,真正的惩罚是 FSRS 的 Again。

**效果指令集(v1 完整版,`game/effects.js` 统一解释,敌我共用)**:
`damage{n,times,target:enemy|all,pierce}` · `block{n}` · `heal{n}` · `draw{n}` · `energy{n}` · `status{id:weak|vulnerable,n,target}` · `strength{n}` · `power{id:metallicize|ramp_strength|extra_draw,n}`;敌方专用:`discard_random{n}` · `energy_drain{n}` · `exhaust_random_discard{n}` · `mimic_last_attack{min}`。

**模板表(28 个;A=攻击 S=技能 P=能力;数值为 T0 基础)**:

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

**初始牌组(10 张)**:5× Strike + 4× Guard + 1× Study,自动绑定玩家稳定度最高的 10 个词(开局即展示"你最熟的词在为你而战")。

**卡面**:左上费用圆点、英文单词大标题、下方小号中文释义、效果文本、类型图标(剑/盾/齿轮,内联 SVG)、稀有度描边(C 灰 / U 蓝 / R 琥珀)、精通档小圆点、钝化遮罩(如钝化)。

### 4.5 战斗规则(结算顺序)

- 玩家:最大 HP 60,全 run 延续;每回合 3 能量、抽 5 张,手牌上限 10;回合末弃手牌;抽牌堆空 → 洗弃牌堆;`exhaust` 本场移除。
- 回合序:玩家回合开始 → 格挡清零 → 能力结算(`extra_draw`/`ramp_strength`)→ 抽牌 → 出牌(逐张完整结算;稀有卡可能触发快答浮层)→ 结束回合 → `metallicize` → 弃牌 → 敌人按列表顺序执行**已亮出的意图** → 敌方状态倒计时 → 敌人亮下回合意图 → 下一玩家回合。
- 伤害公式:`floor((基础 + 力量) × (虚弱? 0.75 : 1) × (目标易伤? 1.5 : 1))`,先扣格挡再扣 HP。虚弱/易伤按回合数递减;力量为本场平坦加成。
- **战斗内快答**:打出**稀有**卡且该词本场未验证过 → 弹出浮层(3.5 秒环形倒计时、单词居中放大、3 个 ≤16 字符的短释义、按键 1–3 或点击、背景战场压暗)。答对 → 足额生效;答错/超时 → 本次数值 ×0.5(向下取整,最低 1)+ "失效"动效。每场每词至多一次;回合制战斗天然可暂停,心流无损。
- 玩家死亡 → run 以 `lost` 结束;击败第 7 层 Boss → `won`。

### 4.6 敌人(几何 SVG + 色板着色 + CSS 待机动画)

`f` = 地图层数 (1–7)。意图为固定循环(种子确定),战前可见。

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

遭遇表:第 1 层单体{墨点/纸灵/逗号精};2–3 层单体{橡皮巨人/红笔}或双体{2×纸灵、墨点+逗号精};4–5 层强化双体{红笔+纸灵、墨点双子}或单体橡皮巨人;精英节点出精英;第 7 层 Boss。

### 4.7 地图生成(后端 `mapgen.py`,全种子确定性)

- 层结构:R1 战斗 ×1(入口)· R2 ×2 · R3 ×3 · R4 ×3 · R5 ×2 · R6 休整 ×1 · R7 Boss ×1 = **13 节点**,单次 run 经过 7 个。
- R2–R5 的 10 个自由槽:恰好 1 个精英均匀落在 R3–R5;其余 9 个按 战斗 0.62 / 事件 0.23 / 休整 0.15 加权,并保证每图 ≥1 事件(无则重掷一个战斗位)。
- 连边(不交叉、全可达):相邻两层 m→n 节点用双指针扫描——`i=j=0` 起连边,比较分数进度 `(i+1)/m` 与 `(j+1)/n`,小者前进(平局同进);每图再加 1 条随机平行边增加选择密度。构造性保证每节点出入度 ≥1、无交叉;pytest 断言可达性。
- 渲染:单个内联 SVG,节点为带类型字形的圆,已走路径高亮,可去的下一节点脉动;7 层无需滚动。
- 随机数:后端 `random.Random(f"{seed}:{用途}")`;前端 `game/rng.js`(mulberry32)只管洗牌动画等观赏性随机,**从不决定结果**。

### 4.8 节点类型

- **战斗/精英**:战胜 → 三选一领卡(经 MCQ,可跳过);精英战后额外回 3 HP。
- **休整**:二选一 —— 休息(回 30% 最大 HP)或**研读**(至多 3 道回忆题,到期词优先;每答对随机将一张可升档的卡 +1 档,上限 T3;答错无进一步惩罚)。复用快答浮层组件,低成本加深复习循环。
- **事件(神秘)** v1 共 4 个:游学者(连对 2 题 → 从 3 张 U+ 卡中选 1;有错则无);旧词典(失 6 HP → 得随机稀有卡,可跳过);静泉(回 15% 最大 HP **或** 删一张牌);记忆之镜(复制一张牌)。
- **Boss**:战斗 → 胜利结算。

### 4.9 运行时持久化

run 开始与**每个节点完成时**存档(不做战斗中存档;战斗中崩溃 → 以进节点时的 HP 重开该节点)。`state_json`(带版本号):

```json
{"v":1, "seed":123456, "book":"TOEFL", "fsrs_enabled":true,
 "hp":47, "max_hp":60, "node_index":4, "path_taken":[0,2,5],
 "map":{"rows":[...], "edges":[...], "types":[...], "encounters":[...]},
 "deck":[{卡对象}],
 "recalled_words":{"abate":{"rating":3,"fsrs_applied":true}},
 "stats":{"battles_won":3,"damage_dealt":182,"recall_correct":5,"recall_total":6},
 "started_at":"2026-07-12T09:00:00Z"}
```

`game_runs` 表的汇总列镜像 `stats`,供历史列表廉价查询。结算屏:结果、层数、战斗数、回忆词数与正确率、FSRS 更新词清单(视觉语言对齐现有"会话完成"页)。

### 4.10 v1 明确不做(留给 v2)

无金币/商店、无遗物、无药水、无档位之外的卡牌升级、无多幕、无战斗中存档。以上全部列为 v2 扩展方向,保证 Phase 5–6 可收敛。

---

## 5. 数据库迁移 v10

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
CREATE INDEX IF NOT EXISTS idx_review_log_word ON review_log(word_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_review_log_time ON review_log(reviewed_at);

CREATE TABLE IF NOT EXISTS game_runs (
    run_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    status         TEXT    NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','won','lost','abandoned')),
    book_name      TEXT,
    seed           INTEGER NOT NULL,
    fsrs_enabled   INTEGER NOT NULL DEFAULT 1,
    state_json     TEXT    NOT NULL,
    floor_reached  INTEGER NOT NULL DEFAULT 0,
    battles_won    INTEGER NOT NULL DEFAULT 0,
    words_recalled INTEGER NOT NULL DEFAULT 0,
    recall_correct INTEGER NOT NULL DEFAULT 0,
    recall_total   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at       TEXT
);
-- 硬性保证:至多一个活跃 run
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_runs_one_active
    ON game_runs(status) WHERE status = 'active';
```

**迁移机制要点**(`db/connection.py`):`SCHEMA_VERSION = 10`;v8 块改为置 `version = 9` 落空;新增 `if version == 9: _migrate_v9_to_v10(); return True`;DDL 同步追加进 `CREATE_TABLES_SQL`(全新建库路径);**`_detect_actual_version()` 在 `Word_Overrides` 探测之后加 `review_log` 探针——缺失则返回 9**(否则 v9 老库被误判 v10 跳过建表);`review_log` 缺 FSRS 前史属预期(旧版本没有逐次记录,自 v10 起记)。`soft_reset_data` 追加清空 `review_log` 与 `game_runs`。

---

## 6. API 契约(重构后全集)

**保持签名与行为不变(仅内部改为委托服务层)**:
`get_app_info` · `update_app_info` · `get_book_names` · `create_book` · `get_book_complete_percentage` · `get_today_stats` · `get_session_words` · `get_due_words` · `complete_session` · `lookup_words` · `import_word_matches` · `get_book_words` · `update_word` · `apply_word_overrides` · `remove_word_from_book` · `get_calendar_info` · `import_clipboard` · `import_excel` · `import_json` · `import_txt` · `export_data` · `import_data` · `export_log` · `open_file_dialog` · `check_for_updates` · `get_update_progress` · `download_and_install_update` · `open_url` · `get_debug_words` · `get_db_stats` · `soft_reset` · `reset_data`

**内部变化(签名不变)**:`record_answer(word, rating)` —— 额外写一行 `review_log`(source=`session`)。

**删除**:`get_unity_games` · `get_game_list` · `start_game_session` · `submit_game_results` · `get_session_result` · `get_ws_server_info` · `launch_unity_game`

**新增(游戏;失败一律 `{"error": str}`)**:

| 方法 | 返回 |
|---|---|
| `game_get_status(book_name)` | `{learned_count, min_required:20, eligible, active_run:{run_id,floor,hp,book}\|null, history:[近10局摘要]}` |
| `game_start_run(book_name, fsrs_enabled=True)` | `{run_id, state}`(放弃既有活跃 run;建词池/初始牌组/地图) |
| `game_get_active_run()` | `{run_id, state}` 或 `{none:true}` |
| `game_save_run(run_id, state)` | `{ok}`(校验活跃;刷新汇总列) |
| `game_get_card_offers(run_id, node_index, context)` | `{offers:[卡×3]}` —— 按 `(seed,node,context,牌组词集)` 确定性生成,防刷新重掷 |
| `game_record_recall(run_id, word, outcome, context, elapsed_ms)` | `{fsrs_applied, rating}`;outcome=`correct\|wrong\|timeout`,context=`claim\|battle\|study\|event`;强制单词单 run 限记一次 |
| `game_end_run(run_id, status, stats)` | `{ok, summary}`;status=`won\|lost\|abandoned` |
| `game_get_run_history(limit=10)` | `[{run_id,status,book,floor_reached,battles_won,recall_accuracy,ended_at}]` |

---

## 7. 实施阶段(每阶段结束应用均可运行;百分比为相对工作量)

### Phase 0 — 开发与验证基建(小,~5%)
纯增量:`paths.py` 支持 `FLASHCARD_USER_DATA` 环境变量;`gui/dev_bridge.py`(`POST /api {"method","args"}` → 调用同一个 Api 对象,`FLASHCARD_DEV_BRIDGE=1` 且非 frozen 才启用,仅绑 127.0.0.1,HTTP 服务换 `ThreadingHTTPServer`);`main.py` 加 `FLASHCARD_NO_WINDOW=1` 无窗模式(容器内跑 e2e);app.js 的 api Proxy 加 fetch 回退 + `DOMContentLoaded` 启动回退(约 10 行,日后原样成为 `core/api.js`);搭 `tests/`(pytest + 夹具库)与 `tests/e2e/`(node Playwright,容器已装 Chromium);`requirements-dev.txt`。

### Phase 1 — 移除旧游戏与全部死代码(小-中,~8%)
按 §2.2 清单执行。Home 页游戏按钮位置留注释占位(新游戏入口回归处)。验收:`grep -rn "game_service|game_ws|GAME_REGISTRY|unity|renderGames|list_generator"` 零命中(迁移历史除外);e2e 冒烟(首页无 Mini Games、学习会话完整可跑、设置可存)。

### Phase 2 — 后端重构(中-大,~15%)
无 schema 变更、无行为变更。按 §3 落地 services/ + db/ 分层;修日历 bug(§2.3-3)与改名;`data/` 净化为纯资产;`youdao_dict.py` 入 scripts/。验收:**黄金主数据测试**——迁移前对夹具库录制 `get_session_words/get_today_stats/get_learned_words/get_db_stats/lookup_words` 输出,迁移后逐字节比对;e2e 全套 + 全新档案的日历打卡断言(修复验证);(用户侧)macOS `python main.py` + `pyinstaller letmepack.spec` 联检。

### Phase 3 — 前端 ES modules 拆分(大,~18%)
行为等价搬运,**不改逻辑**。按 §3.2/3.3 拆 js/ 与 css/;63 处 onclick 机械转换为 data-action 委托。验收:Phase 0 建立的 e2e 套件原样通过(它就是拆分的回归护栏);新增:返回栈、闪卡键盘捷径、刷新后续玩(localStorage)、遍历所有视图点击每个控件一次。

### Phase 4 — v10 迁移 + 游戏后端(中-大,~15%)
§5 的 DDL 与阶梯重排;`review_repo`/`run_repo`;`fsrs_service.record_answer` 写日志;`services/game/`(run 生命周期、领卡三选一、MCQ 生成、mapgen、balance)——全部 `random.Random(f"{seed}:{node}:{用途}")` 确定性,可单测、防刷新重掷。验收:pytest 迁移矩阵(合成 v1 / 合成 v9 / v9 无版本行 / 全新空库 → 全部落 v10 数据完好;另设慢速可选项跑真实 34MB 种子库全程);三选一确定性;地图不变式(节点数、全可达、恰 1 精英、≥1 事件、构造性不交叉);档位数学表;限记一次;唯一活跃 run 索引;学习会话 e2e 仍绿。

### Phase 5 — 游戏前端纵切片(特大,~25%)
以内容子集打通端到端:游戏首页(开始/续玩/历史)→ 地图渲染与走位 → 战斗(约 10 模板 + 4 敌人)→ 领卡 MCQ → 休整 → Boss → 胜负结算 → 节点粒度存读档。`game/effects.js` 效果虚拟机统一解释敌我 op 列表。Home 按钮「Word Spire」回归。验收:e2e 游戏规格(25 词夹具档案、注入固定种子:开局→打赢一场→答对领卡→到休整→到 Boss→败北→历史入账;刷新页面续玩成功);人工试玩清单(一局 ≤25 分钟、无死路地图、无不可出牌僵局)。

### Phase 6 — 内容补全与打磨(大,~12%)
28 模板全量、敌人全阵容 + 精英 + Boss 机制、4 事件、战斗内快答浮层、休整「研读」、结算屏 FSRS 汇总、动效与过场、平衡试玩、游戏调试面板(S.debug:改 HP/加卡/揭地图)。验收:平衡清单(初始牌组打第 1 层敌人失血 ≤8;10 张 T0 普通卡的牌组能过第 4 层双体;快答选项 ≤16 字符——用真实 GRE/TOEFL 释义跑 pytest 验证);e2e 快答对/错/超时三分支;4 事件各可玩通。

### Phase 7 — 收尾(小,~2%)
README 重写(架构图、游戏介绍)、`version.py` → 0.2.0、`letmepack.spec` 复核(websockets 已删、datas 形状不变)、终扫 `grep -rn "game_ws|list_generator|calender|unity"` 零命中(迁移代码与历史除外)。macOS 打包验证需用户本机执行(容器无法出 .app)。

---

## 8. 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| 1 | **种子库是 v1,迁移阶梯 = 全新安装主路径**,重排出错即砖 | pytest 迁移矩阵(4 种起点)+ 可选真种子库全程;`_detect_actual_version` 加 v10 探针 |
| 2 | 模块拆分弄坏学习会话 | Phase 3 纯搬运;`PS`/`SESSION_STORE_KEY` 冻结;e2e 覆盖 FIG 对/错→MCQ(Hard)/MCQ 错→重排(Again)/中途存续/完成/日历点 |
| 3 | pywebview + ES modules 时序(模块先于 API 注入执行) | `core/api.js` 首调前等待 `pywebviewready`(带存在性快路径);HTTP 加载模块本身无碍 |
| 4 | 薄门面装饰器 vs pywebview 暴露机制 | `functools.wraps`;门面保留显式参数签名(pywebview 按位置传参);开发桥逐方法冒烟 |
| 5 | 错误返回形状漂移(JS 依赖 `get_book_names→[]` 等) | 装饰器显式 `fallback=`;§6 契约为唯一事实源;e2e 断言关键形状 |
| 6 | 游戏刷分扭曲 FSRS | 封顶 Good、单词单 run 限记一次、`fsrs_enabled` 总开关、review_log 审计 |
| 7 | 奖励重掷利用 / 续玩分歧 | 三选一按 `(seed,node,context,牌组词集)` 确定;领卡与存档间崩溃的边缘情况接受并文档化 |
| 8 | 游戏范围失控 | §4.10 明确 v1 裁剪;Phase 5 纵切片先行,试玩清单通过才进 Phase 6 |
| 9 | 移动模块弄坏 PyInstaller | 全静态导入;datas 形状不变;Phase 2/7 后由用户本机打包验证 |
| 10 | 日历改名 + 老用户旧文件 | 启动时旧名重命名回退;`"{}"` 损坏自愈;e2e 断言全新档案打卡(现状真 bug,重构顺手修复) |
| 11 | 开发桥误入发行包 | 双重门控(环境变量 + 非 `sys.frozen`);否则 404;Phase 7 终扫 |

---

## 9. 验证基建说明

- **e2e**:容器预装 node 22 + Playwright CLI + Chromium(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`)。`FLASHCARD_DEV_BRIDGE=1 FLASHCARD_NO_WINDOW=1 FLASHCARD_USER_DATA=<临时目录> python3 main.py` 起无窗服务,Playwright 驱动 `http://127.0.0.1:18765`。开发桥同时是日常开发的快速迭代通道(浏览器直接调后端)。
- **单测**:`pip install pytest fsrs`(dev-only);`services/` 顶层禁止 `import webview`(以测试强制),保证服务层可脱离 GUI 测试。
- **人工**:macOS 打包与自更新流程需用户本机验证(容器无法构建 .app)。

## 10. v2 扩展方向(非本期)

遗物系统(绑定"词根/词缀"主题)、商店与货币、药水、多幕多 Boss、卡牌升级树、每日挑战(固定种子排行)、听力回忆模式(播放发音选义)、词书专属敌人皮肤、真实美术素材接入(替换几何 SVG)。
