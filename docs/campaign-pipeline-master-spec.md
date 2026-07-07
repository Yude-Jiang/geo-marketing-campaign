# MASTER SPEC · 可复用 Campaign 流水线（阶段 × 工件契约）v1.1

> **版本定位**：v1 重在"思路通"（方法论骨架）；**v1.1 重在"能跑、能管、能复用"**——机器可执行、多人可协作、版本可治理的系统规范版。
>
> **已有引擎映射**（不重写，直接挂载）：
> S3 执行 →《SDV-GEO-Diagnosis-Eval-Protocol v1.1》｜S4 判读 →《GEO-Diagnosis-to-Campaign-Insight-Prompt》｜S5 计划 →《Campaign-Plan-System-Instruction v2》｜S6 成稿 →《Content-Generation-Prompt》＋物料 skill（st-ppt-brand 等）｜S0/S1/S1.5/S2/S8 由本规范定义。

---

## 0. 对象模型（所有工件的统一元数据）

**所有核心 `.md` 工件采用 YAML front matter + markdown body**（人可读、agent 可 parse、可自动化）：

```yaml
---
campaign_id: CAM-2026-001        # 唯一项目编号
business_line: sdv-ee            # 主题线/产品线
market: CN
language: zh-CN
owner: <负责人>
version: v1.0
status: draft                    # draft / approved / frozen / deprecated
approval_by: <批准人>            # status 非 draft 时必填
approval_date: <YYYY-MM-DD>      # 同上；对外使用的批准需注明 scope: external
source_of_truth: [<上游文件名>]  # 本工件依据的上游工件
last_updated: <YYYY-MM-DD>
---
```

**状态语义**：`draft` 可改；`approved` 进入下游消费；`frozen` 不可改（改动必须升版本号 + 重走审批）；`deprecated` 禁止任何下游引用。`approved/frozen` 必须带 approval_by/approval_date——"批准"是可追溯的动作，不是字面状态。

---

## 1. 流水线总览（0-9 骨架，v1 保留）

```
S0 盘点 → S1 Persona/VP 假设 → S1.5 Message Map → S2 问题集设计 → S3 诊断执行
   → S4 判读 + ⟲回填 S1/S1.5 → S5 计划与时间线 → S6 内容生产
   → S7 前置检查 + 分发 → S8 复测 + 行动决策 ⟲ → S9 复盘进化 ⟲
```

---

## 2. 全局协议（所有阶段与 agent 继承）

### 2.1 工件即契约

每阶段只认上游工件文件；**必填字段缺失或 status 不符 = 拒绝执行并列出缺项**。不依赖对话上下文传状态。

### 2.2 阈值与决策门协议（核心治理机制）

- **阈值只生成 recommended default（默认裁决）；决策门才生成 effective decision（生效决策）；没进 decision-log 的，不算正式裁决。**
- 流程：阈值产出默认裁决 → owner 确认或推翻 → 写入 `decision-log.md`（全局工件，归 Orchestrator 维护）→ 下游只能消费已生效的决策。
- `decision-log` 必须记录两类内容：**决定了什么**；**推翻了哪个默认裁决、为什么推翻**（供 S9 分析"默认裁决是否越来越准"，迭代阈值体系）。
- 需过门的判断（◆）：persona/VP 取舍、页面分档、竞品断言口径、火力比例、对外措辞与数字边界、发车放行、复测行动。
- 阈值永远不替代人的语义判断（案例：PRS 与 eFuse 是两个搜索意图——阈值发现不了，人能）。

### 2.3 Orchestrator 权限条款（护城河，强约束）

> **总控可以：校验、分派、驳回、要求返工、生成派生视图、记录版本与决策。**
> **总控不得：自行补事实、补字段、补证据、补版本状态，或将不合规工件"顺手修成"合规。**
> （Orchestrator may validate, route, reject, request revision, and derive views. It must NOT invent missing facts, repair incomplete contracts, or normalize non-compliant artifacts.）

契约不符时的唯一动作：打回上游 agent 重做并列明缺项。

### 2.4 证据纪律

任何量化数据只能引自 `S0-evidence-registry.csv`；registry 没有的 → 先入册（带来源与等级）再引用，或标 `【填:xxx——需公开来源】` 并回写 gap-list。**绝不虚构。**

### 2.5 双颗粒度与对外措辞

内部工件（细）与对外版本（里程碑级、无数字承诺、监测方向）信息不混流；对外称 campaign/content tactics，诊断称 diagnosis，不用"GEO tactics"；竞品断言援引诊断记录来源。

---

## S0 · 盘点（Intake）

**输出工件**：

1. **`S0-charter.md`**——必填字段：主题线（成熟度+主次，多线打法镜像：新品类=教育/造需求/看增长，成熟=收割/守成/看不缺席，分开判读；跨线资产定主家）；产品方案锚；目标页面清单（URL+追踪参数+上线状态+语言）；**页面承接度评估**（见下）；资源（预算、人力、自有渠道、已有内容）；一句话成功定义与 target 类型；市场约束与合规红线。
2. **`S0-evidence-registry.csv`**——列：`claim_id / business_line / 论点 / 数字·事实 / 来源链接 / 来源等级 / 是否可外用 / claim_scope / 失效日期 / 备注`。
   - **claim_scope（适用范围）**：全球 vs 特定市场、某代产品 vs 当前产品、技术可行 vs 商业可用、品牌级 vs 单型号级——防"引用没错、语境错了"。
   - **失效日期**：market-first 类声明（如"首款内置 NPU 车规 MCU"）有保质期，竞品出货即过期。
   - registry 是**可追加的单一事实源**：允许"先入册、后引用"，不允许绕过。
3. **`S0-gap-list.md`**——内容会用到但 registry 还没有的证据缺口。
4. **`S0-operating-rhythm.md`**（PMO 层，双模式）——**Solo 必填**：工件冻结规则、变更升版规则、复测周期；**团队 optional→产品化后 required**：周会节奏、各阶段负责人与最长耗时、内容 SLA、审批点。

**页面承接度评估（与"心智可争夺性"正交的第二维）**：

| 承接档 | 定义 |
|---|---|
| Tier A | 信息完整，可直接承接主战场叙事，可投可链 |
| Tier B | 主题对但证据弱，导流前需补内容 |
| Tier C | 可被引用但不能承接转化 |
| Tier D | 暂不投入 |

> 心智可争夺性（S4 产出）决定**该不该打**；页面承接度（S0 产出）决定**导流过去接不接得住**。一个页面可以同时是"主战场"与"Tier B"——此时先补页面再放量。承接度是 S7 前置门的输入。

---

## S1 · Persona & Value Proposition（假设版）

**输出**：`S1-persona-vp.md`——Persona 卡（角色/关心/不关心/信息渠道/决策影响/匹配形式）＋每线主 VP+子 VP，**全部带 `[假设]` 标记与"待诊断验证的点"**。S4 后必须回填修正（证实/推翻/修正显式记录）。

◆ 决策门：persona 取舍与 VP 方向。

---

## S1.5 · Message Map（轻量层，独立工件）

**输出**：`S1.5-message-map.md`——每业务线：`主张 / 支撑理由 / 证据类型（链接 registry claim_id）/ 禁用表述 / 适合渠道`。

**禁用表述分三类**（触发原因不同，分栏执行）：

1. **Brand wording banned**：空泛营销词（"领先""赋能""助力"…）。
2. **Evidence-risk banned**：无 registry 支撑的绝对化/量化表述（"最X""可省X%"无来源）。
3. **Channel-risk banned**：特定社区反感话术（知乎/工程师论坛的软广腔、开头带品牌等）。

S2 的问题设计、S5 的计划、S6 的内容生成统一消费此话术骨架。

---

## S2 · 基准问题集设计

**输出**：`S2-benchmark-questions.md`（品类层/子节点层，中英双语、中文主测、两语不混轨）。

**构成规则**：无死指标（每题必须有变化空间）；主战场 ≥2 题；S1.5 每条主张至少 1 题在追踪；至少一半问题有真实提问证据（知乎现有问题/搜索词/FAE 反馈）；**定稿即 frozen，换题=新版本+重建基线**。

---

## S3 · 诊断执行

**引擎**：GEO 诊断工具＋《Eval-Protocol》Part A 铁律（零提示、固定模型集、多次取共性、心智占位与内容货架分轨）。

**输出**：原始诊断报告＋`S3-run-meta.md`（日期/模型/次数/异常）。

---

## S4 · 判读 → 作战洞见（含回填）

**引擎**：《GEO-Diagnosis-to-Campaign-Insight-Prompt》。

**输出**：

- `S4-battle-map.md`：认知形状（稳定/波动区分）→ 竞品分层（**威胁分级默认裁决**：稳定压制/可争夺/偶发出现/噪音型提及，按跨次出现频率给默认，owner 过门）→ 页面心智分档（主战场/攻坚/守位/挂钩，默认裁决+过门）→ 作战卡组（7 栏+Action 组+监测方向）。
- ⟲ 回填 `S1-persona-vp.md` 与 `S1.5-message-map.md`（假设翻转显式记录，如"空白区→错误定位"）。
- `S4-next-question-backlog.md`：intent 矩阵中未被问题集覆盖的高价值问题（不动当前冻结集）。

◆ 决策门：分档、竞品口径、提及≠领导权类判断。

---

## S5 · 计划与时间线

**引擎**：《Campaign-Plan-System-Instruction v2》（火力分配、渠道逻辑、付费跟随内容、呈现形式选择）。

**输出**：

- `S5-plan-internal.md`：周级排期、负责人、**生产分级默认裁决**（A 类人工主笔=定调件+对抗性叙事；B 类 AI 初稿+人深改；C 类 AI 产+人审）、数字目标与占位。
- `S5-plan-share.{html,pptx}`：对外版（里程碑时间线、复查节点作菱形里程碑嵌入、无数字承诺）。
- 证据链三角规划：每张作战卡的 Action 组标明三角布链（目标页 ↔ 长文 ↔ 问答/论坛互链）。
- **`S5-channel-matrix.md`（derived view）**：由 Orchestrator 从全部作战卡自动汇总（作战卡×persona×funnel×渠道×形式×CTA×监测指标），用于看渠道过载/空档与资源盘点。**协议条款：channel-matrix 为派生视图，不允许手工编辑成为策略源文件；与作战卡冲突时，以作战卡为准。KPI 列只准引用监测方向与 publish-log 可观测指标，不得发明新 KPI。**

◆ 决策门：火力比例、对外边界。

---

## S6 · 内容生产

**引擎**：《Content-Generation-Prompt》（作战卡即工单）＋物料 skill。

**规则**：只能从 `S0-evidence-registry.csv` 取数（新证据先入册）；每稿输出**引用证据映射**（用了哪些 claim_id）＋六问自检＋待填清单（回写 gap-list）；生产分级按 S5 默认裁决执行（A 类必须人深度参与——纯 AI 味在工程师社区会被识破反噬）；措辞过 S1.5 三类禁用表述检查。

---

## S7 · 前置检查 + 分发

**输出**：`S7-launch-checklist.md`（逐项勾选，全过才发车）＋`S7-publish-log.md`（每篇实际 URL/日期/渠道/所属作战卡——复测归因用）。

**前置门**：① 目标页面上线、语言正确、URL+追踪参数逐一验证，且**承接度达标**（主战场导流页 ≥Tier B 并有补强计划，Tier C/D 不得作为放量落地页）；② 归因分析已配置；③ 涉合规叙事已过审。

**分发**：付费跟随内容（未索引不投对应词；先防守已赢词后进攻新词；信息流造需求、搜索收割）。

◆ 决策门：发车放行。

---

## S8 · 复测 + 行动决策

**引擎**：《Eval-Protocol》Part B-E（冻结基线+intent 真空追踪）。

**输出**：`S8-recheck-N.md`——每题现值 vs 基线＋真空追踪＋**行动默认裁决**（owner 过门后执行）：

| 复测发现 | 默认裁决 |
|---|---|
| 真空被我们填上 | 巩固内链，火力转移下一缺口（回 S5） |
| 真空被竞品填上 | 升级优先级，换角度再攻（回 S4）——最危险信号 |
| 连续 2 期无变化 | 先查索引/抓取/分发（S7 日志核对）——多为打法问题 |
| 连续 3 期无变化 | 回 S4 重判该缺口可争夺性 |
| 已赢阵地滑落 | 转入防守计划（防守内容+付费守词） |

**双流互证**：probe（先行：认知）× 页面侧 AI referral 流量与追踪归因（滞后确认：行为）。probe 涨流量未至=转化在路上；流量至 probe 未动=多半付费在推、非心智。

---

## S9 · 复盘进化（meta）

**输出**：`S9-retrospective.md`——本轮新坑与新规则回写本 Spec 与各引擎（升版本）；**分析 decision-log 中被推翻的默认裁决**，迭代阈值体系（这是阈值体系自我校准的数据源）；工件全套归档为案例库。

---

## 附录 A · Agent 架构（1 总控 + 6 专业）

| Agent | 阶段 | 核心输出 |
|---|---|---|
| **Orchestrator**（项目经理+质控，不产内容） | 全程 | 契约校验、阶段流转、`decision-log.md`（全局）、派生视图（channel-matrix）、版本治理。权限见 §2.3 |
| Intake Strategist | S0 | charter / evidence-registry / gap-list / operating-rhythm |
| Audience & Benchmark Designer | S1-S2 | persona-vp / message-map / benchmark-questions |
| GEO Analyst | S3-S4 | run-meta / battle-map / next-question-backlog / 回填 S1·S1.5 |
| Campaign Planner | S5, S7 | plan-internal / plan-share / launch-checklist / publish-log 规范 |
| Content Studio | S6 | 成稿＋引用证据映射＋自检＋待填清单（不做战略判断） |
| Recheck Analyst | S8-S9 | recheck-N / retrospective / 流水线改进建议 |

**设计原则**：相邻阶段共享上下文的合并为一个 agent（agent 数 < 阶段数）；agent 间只通过工件交接；decision-log 是治理协议不是某 agent 的资产。

---

## 一句话总纲

**盘清家底与证据（registry 单一事实源）→ 立假设并搭话术骨架（persona/VP/message map，待验证）→ 设计可长期复测的冻结问题集 → 干净诊断 → 判读并回填假设 → 分档定火力、双版本计划、三角布链（channel-matrix 只是派生视图）→ 分级生产、只从 registry 取数 → 过前置门发车（付费跟内容）→ 冻结基线复测、按默认裁决+决策门行动 → 复盘回写、用被推翻的默认裁决校准阈值。阈值给默认，门给生效，日志给追溯——总控只管校验分派，绝不替人补事实。**
