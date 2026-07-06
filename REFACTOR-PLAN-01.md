# REFACTOR-PLAN-01 · 意图坐标系框架化 + 冻结对齐

> 状态:**方案待 review,未改任何代码。**
> 前置:`CURRENT-STATE.md` / `GAP-ANALYSIS.md`。标尺:`docs/campaign-pipeline-master-spec.md`。
> 目标:把"意图框架"从 LLM 每次现聚类的临时产物,提取成**可配置(数据)、可冻结(状态位+写保护)、可对齐(维度锚)**的结构化骨架。
> 范围纪律:严格遵守四个硬约束;"不在本刀范围"的六项一律不做,只保证数据结构**能容纳**未来演化。

---

## 0. 一个会改变设计的核实发现(先说,因为它决定写保护落点)

`updateCampaign(patch)` 在 `workflowStore.ts:99,130` 有定义,但**全 repo 零调用方**。UI 真正的写入路径是 `setCampaign(...)` 的**全量替换**:
- `StepCampaignDiscovery.tsx:117` `setCampaign(result)`(新建/重跑)
- `StepCampaignBlueprint.tsx:76` `setCampaign({ ...campaign, reportGeneratedAt, status })`(报告后)
- `StepCampaignBlueprint.tsx:111` `setCampaign({ ...campaign, probes, progressSnapshots })`(复测后)

**结论**:GAP-ANALYSIS 契约 B 说的"`updateCampaign` 接受任意 Partial 无保护"属实,但真正需要拦截的写入向量是 **`setCampaign` 全量替换**。写保护必须同时覆盖两者,且核心逻辑放在 `setCampaign`(否则形同虚设)。这条贯穿第 3 节。

---

## 1. 数据模型设计

### 1.1 三层框架的落位总览

| Spec 三层 | 建模为 | 存放 | 冻结/演化性质 |
|---|---|---|---|
| 底层:工程决策维度(7 维) | `EngineeringDimension[]`(framework 定义内) | **framework 定义**(可配置数据,带 version) | 稳定坐标系,冻结锚 |
| 中层:根因诊断(9 类) | `RootCauseType[]`(framework 定义内,含 repairAction) | **framework 定义** | 定义稳定;每题命中的根因随每轮诊断变(已存在 probe 上) |
| 锚点:语义锚点 | `SemanticAnchor`(结构化对象) | **每个 SeedQuestion 上** | 随问题冻结;预留 source/claimId 接证据登记表 |

关键分工:**framework 存"定义"(维度/根因是什么),campaign 存"实例"(这次用哪个 framework 版本、每题归哪个维度、每题锚点是什么、冻没冻)。**

### 1.2 新增类型(新文件 `src/types/framework.ts`)

```ts
// ── 底层:工程决策维度(稳定坐标系,冻结锚)──
export interface EngineeringDimension {
  id: string;          // 稳定 id,如 'cost-performance';全流程只用 id 引用
  label: string;       // 展示名(见 §Open-Q6 关于多语言)
  description: string;
}

// ── 中层:根因的修复动作定义(本刀只存,不驱动生成)──
export interface RepairAction {
  summary: string;                       // 建议动作描述
  actsOn: 'this-question' | 'new-question';
  // COMPETITOR_DOMINANCE => 'new-question'(换角度/语义派生新问题,作用于新问题);
  // 其余 => 'this-question'。本刀仅标注,不实现派生流程。
}

export interface RootCauseType {
  id: string;          // 复用 GeoFailureCategory 字面量作 id(见 §1.4)
  label: string;
  description: string;
  repairAction: RepairAction;
}

// ── framework 定义对象(可配置数据 + 版本)──
export interface IntentFrameworkDefinition {
  id: string;          // 'semiconductor-b2b'
  version: string;     // 语义化版本 'v1.0.0'
  label: string;
  description: string;
  dimensions: EngineeringDimension[];
  rootCauses: RootCauseType[];
}
```

### 1.3 新增类型(加入 `src/types/campaign.ts`)

```ts
// ── 锚点:语义锚点(独立结构化字段,预留证据登记表接口)──
export interface SemanticAnchor {
  text: string;                 // 可验证锚点,如 "$0.64 entry price cited"
  source?: string | null;       // 预留:未来指向证据来源
  claimId?: string | null;      // 预留:未来指向 evidence-registry 的 claim_id
}

// ── 意图坐标系(治理 + framework 绑定层,冻结的主体)──
export interface IntentCoordinateSystem {
  frameworkId: string;          // 冻结时绑定
  frameworkVersion: string;     // 冻结时绑定的"那一版",复测永远用它对齐(约束 2)
  frozen: boolean;              // 治理状态位(约束 3),区别于 CampaignStatus 流水线进度
  frozenAt?: string;            // ISO;frozen=true 时必填
  activeDimensionIds: string[]; // 本 campaign 激活的维度子集;结构支持未来"激活新维度"(容纳演化,不实现操作)
}
```

### 1.4 现有类型改动点(逐个,指到行)

**`SeedQuestion`(campaign.ts:73-84)**
- 新增 `dimensionId: string`——问题归属的稳定维度(对齐锚)。**这是取代 LLM 现聚类的核心字段。**
- `expectedAnchor?: string`(:81)→ 替换为 `anchor?: SemanticAnchor`。语义升级:从松散字符串变结构化对象。
- `intentGroupId: string`(:78)→ **标记 `@deprecated`,保留可选**,由 migration 回填为 `dimensionId`,过渡期不删(避免一次性动太多下游)。

**`SeedQuestionPreprocessResult`(campaign.ts:94-98)**
- `intentGroups: IntentGroup[]`(:96)语义**从"LLM 现聚类"改为"由维度确定性派生的组"**。字段名保留(减少下游 churn),但**填充方式改为代码构建**:按 `dimensionId` 分组、label 取自 framework 维度定义。新增 `frameworkId`/`frameworkVersion` 冗余记录(便于本对象自解释)。
- `IntentGroup`(campaign.ts:86-91)结构不变(id/label/questionIds/description),但 `id` 现在**等于 dimensionId**(稳定),不再是 `ig-1` 这种临时 id。

**`GeminiProbeSnapshot`(campaign.ts:103-119)**
- `primaryFailure: GeoFailureCategory`(:116)——语义明确为"framework 根因 id"。**结构不变**(已经是枚举),仅在文档/注释上确立它是 `RootCauseType.id`。这样 root cause 层的改动量趋近于零,符合"根因已存在于 probe"。
- `anchorStatus?`(:117)保留(每轮验证结果),不动。

**`Campaign`(campaign.ts:246-263)**
- 新增 `intentFrame?: IntentCoordinateSystem`。这是冻结主体。

**`GeoFailureCategory`(types.ts:101-110)**
- **不改枚举**。framework 的 `rootCauses[].id` 直接复用这些字面量做 id。好处:现有 24 处 `primaryFailure` 引用零改动;framework 只是给每个 id 补上 label/description/repairAction 的"定义表"。

### 1.5 关系图(改造后)

```
IntentFrameworkDefinition (config, 带 version, 存于 registry)
  ├── dimensions[]  ← SeedQuestion.dimensionId 按 id 引用(稳定锚)
  └── rootCauses[]  ← GeminiProbeSnapshot.primaryFailure 按 id 引用

Campaign
  ├── intentFrame: IntentCoordinateSystem  { frameworkId, frameworkVersion(冻结版), frozen, activeDimensionIds }
  ├── preprocess
  │     ├── questions[]  (每题: dimensionId + anchor:SemanticAnchor,冻结后不可改)
  │     └── intentGroups[]  ← 代码按 dimensionId 派生(id=dimensionId,label 取自 framework@冻结版)
  ├── probes[]  (primaryFailure = 根因 id;questionId 配对对齐)
  └── progressSnapshots[]  (delta 按 dimensionId 稳定对齐)
```

---

## 2. framework 种子(半导体 7 维 9 类,完整定义)

内置为第一个实例 `SEMICONDUCTOR_FRAMEWORK_V1`(id=`semiconductor-b2b`, version=`v1.0.0`)。label 先给中文(多语言策略见 Open-Q6)。

### 2.1 工程决策维度(7)

| id | label | description |
|---|---|---|
| `cost-performance` | 成本与性能权衡 | 单价/BOM 成本与算力、主频、能效之间的取舍;工程师"要不要为性能多付成本"的纠结。 |
| `reliability-safety` | 可靠性与功能安全 | 车规/工规等级、功能安全认证(ASIL/SIL)、失效率、宽温与长期可靠性。 |
| `migration-compat` | 迁移与兼容 | 从既有架构/竞品/上一代迁移的成本;引脚兼容、指令集兼容、软件可移植性。 |
| `integration-simplification` | 集成度与系统简化 | 片上集成(NPU/无线/模拟)带来的 BOM 精简、板级面积、系统复杂度下降。 |
| `ecosystem-devexp` | 生态与开发体验 | 工具链、SDK、参考设计、社区与文档质量;上手速度与调试体验。 |
| `environmental` | 环境与物理适应 | 温度/湿度/振动/EMC 等物理环境适应;封装与散热约束。 |
| `compliance-standards` | 合规与标准 | 行业标准符合性、法规准入、认证与出口合规红线。 |

### 2.2 根因诊断(9,含修复动作)

| id | label | description | repairAction.summary | actsOn |
|---|---|---|---|---|
| `CORPUS_ABSENCE` | 语料缺失 | AI 训练语料里几乎没有该产品/特性的信号。 | 建设权威语料:官方文档、结构化规格页、可被抓取的技术长文。 | this-question |
| `ATTRIBUTE_MISMATCH` | 属性错配 | AI 认得产品但引用了错误的价格/规格/定位。 | 发布权威更正内容,以结构化数据钉正确属性。 | this-question |
| `BURIED_ANSWER` | 答案被埋 | 答案在 PDF/datasheet 里,AI 爬不到。 | 把关键结论从 PDF 提到可抓取的 HTML,BLUF 前置。 | this-question |
| `COMPETITOR_DOMINANCE` | 竞品压制 | 竞品语料密度远超我方,AI 默认推荐竞品。 | **换角度/语义派生新问题**,绕开竞品强势语义正面战场。 | **new-question** |
| `SEMANTIC_IRRELEVANCE` | 语义错位 | 我方用词与用户提问词不在同一语义空间。 | 用用户真实提问词改写内容锚点与标题。 | this-question |
| `OUTDATED_CONTENT` | 内容过时 | AI 引用了过时的价格/EOL/定位。 | 发布带时间戳的更新内容,标注失效旧信息。 | this-question |
| `TRUST_CREDIBILITY` | 信任缺失 | 没有 GitHub/arXiv/官方文档等可信引用支撑。 | 建设第三方可信信号:开源仓库、论文引用、权威背书。 | this-question |
| `STRUCTURAL_WEAKNESS` | 结构薄弱 | 内容有答案但缺 BLUF/片段友好结构。 | 重构为片段友好结构(表格/列表/代码块/结论前置)。 | this-question |
| `UNKNOWN` | 未知/无显著失败 | 未识别到明显失败(通常 ST 已强绑定)。 | 无需修复;转守位监测。 | this-question |

> 注:`COMPETITOR_DOMINANCE.actsOn='new-question'` 仅作定义标注,**本刀不实现派生流程**(明确在"不在本刀范围")。

### 2.3 registry 与解析器(约束 1 + 约束 2 的机制)

新文件 `src/config/intentFramework.ts`:

```ts
const FRAMEWORK_REGISTRY: Record<string, IntentFrameworkDefinition> = {
  'semiconductor-b2b@v1.0.0': SEMICONDUCTOR_FRAMEWORK_V1,
  // 未来演进 => 追加 'semiconductor-b2b@v2.0.0',旧版永不删除(约束 2 命脉)
};
export const DEFAULT_FRAMEWORK_ID = 'semiconductor-b2b';
export const DEFAULT_FRAMEWORK_VERSION = 'v1.0.0';

export function resolveFramework(id: string, version: string): IntentFrameworkDefinition | null;
export function getDimension(fw: IntentFrameworkDefinition, dimId: string): EngineeringDimension | null;
export function getRootCause(fw: IntentFrameworkDefinition, rcId: string): RootCauseType | null;
export function isValidDimensionId(fw, dimId): boolean;
```

**约束 1 落地**:所有代码通过 `getDimension(fw, id)` / `getRootCause(fw, id)` 按 id 取定义,**任何地方不得 `if (dimId === 'cost-performance')` 这类硬编码分支**。换行业 = 往 registry 加一份新定义 + 让 campaign 绑它,核心代码零改。
**约束 2 落地**:registry 按 `id@version` 保留所有历史版本;`resolveFramework` 用 campaign 冻结时记录的 `frameworkVersion` 取,后续默认版升级不影响历史 campaign。

---

## 3. 冻结机制落点(约束 3 命脉)

### 3.1 冻结点:Discovery 确认

`StepCampaignDiscovery.tsx:129 handleConfirm`——用户看完基线表点"确认"进 Step 2,是自然的冻结时机。改动:确认时调用新 store action `freezeIntentFrame()`,把 `campaign.intentFrame.frozen=true` + `frozenAt=now`。此前(preprocess 完成、Step1 展示期)`intentFrame.frozen=false`,允许(未来的)编辑。

### 3.2 framework version 绑定与记录

- 在 `runCampaignPipeline`(`campaignPipeline.ts:126`)构建 campaign 时,初始化 `intentFrame = { frameworkId: DEFAULT_FRAMEWORK_ID, frameworkVersion: DEFAULT_FRAMEWORK_VERSION, frozen: false, activeDimensionIds: [...实际出现的维度] }`。
- **绑定发生在创建时,冻结时定格**。冻结后 `frameworkVersion` 不可变(受 §3.3 写保护)。
- 复测(`probeDelta` / `intentMetrics` / 报告)解析 framework 一律走 `resolveFramework(intentFrame.frameworkId, intentFrame.frameworkVersion)`——用**冻结那一版**,不用 DEFAULT。

### 3.3 写保护(拦在 setCampaign,兼顾 updateCampaign)

核心:新增纯函数 `applyFreezeGuard(current, next): Campaign`,在 `workflowStore.ts` 的 `setCampaign` 与 `updateCampaign` 内部统一调用。

规则(仅当 `current.intentFrame?.frozen === true` 且 `next` 是同一 campaign id 的更新时生效):
- **受保护、拒绝变更的字段**(冻结的意图结构):`preprocess.questions`(text/dimensionId/anchor/tier/priority)、`preprocess.intentGroups`、`intentFrame.frameworkId/frameworkVersion/frozen 的非法翻转`。
- **允许变更的字段**(下游/追加,复测链路依赖):`probes`(追加复测)、`synthesis`(叙事)、`progressSnapshots`、`status`、`reportGeneratedAt`、`updatedAt`。
- 违规处理:**strip + warn**(丢弃受保护字段的改动、保留合法部分、`console.warn` 记录),而非 throw。理由:`setCampaign` 在多处以全量 spread 调用,throw 会破坏 UI;strip 既守住不变量又不炸流程。冻结语义上"改不动",实现上"改了也不生效"。
- 换 campaign(`next.id !== current.id`,即新建/重跑)不走字段级保护,走 §3.4。

`updateCampaign(patch)`:虽当前无调用方,一并接入 guard,堵住 GAP 契约 B 点名的洞。

### 3.4 重跑 Step 1 摧毁冻结基线(GAP 契约 B.3)

`StepCampaignDiscovery.handleRun`(:105-117)每次 `setCampaign(全新 campaign)`,会静默覆盖已冻结的 campaign(连基线+复测历史)。本刀最小防护:
- `setCampaign` 内当检测到 `current.intentFrame?.frozen && next.id !== current.id`(用新 campaign 覆盖已冻结的旧 campaign)时,**不静默替换**——需要显式意图。
- 具体交互(hard block / 确认弹窗 / 仅 warn)见 **Open-Q5**,推荐"确认弹窗",但它触及 UI 文案与三语翻译,列为待定。**数据层**先加一个 `setCampaign(next, { force?: boolean })` 的 force 开关,UI 决策定了再接。

> 单 campaign 覆盖式存储(只存一个)本身是更大的问题,属"多 campaign 持久化"范畴,**不在本刀**。本刀只堵"冻结后被静默覆盖"。

---

## 4. 对齐逻辑改动(约束 4)

核心不变量:**复测不重新聚类,delta 在同一 dimensionId 两端算。** 现有链路其实已经"按 questionId 配对",本刀把"组级对齐"从临时 intentGroup 迁到稳定 dimension,并用冻结版 framework 解析标签。

### 4.1 preprocess 改造(`campaignGeminiService.ts`)——去 LLM 聚类,改 LLM 归类

- **prompt(:260-280)**:删掉"Group into 2-4 intentGroups / Assign ig-1…"(:273,278)。改为给出**冻结 framework 的维度清单(id+label+desc)**,要求 LLM 为每题**从固定维度里选一个 `dimensionId`**(归类,不是聚类)。同时要求产出结构化 `anchor.text`(替代 :275 的 expectedAnchor 措辞)。
- **schema(:23-57)**:questions.items 加 `dimensionId`(required)、`anchor:{text,...}`;移除顶层 `intentGroups`(:42-54)——组不再由 LLM 产出。
- **组的构建改为代码**:新增确定性函数 `buildDimensionGroups(questions, framework): IntentGroup[]`(放 `intentMetrics.ts` 或框架模块),按 dimensionId 分组、label 取 `getDimension().label`。`preprocessSeedQuestions` 返回时用它填 `intentGroups`。
- **非法/缺失 dimensionId**:用 `isValidDimensionId` 校验;非法 → 归入保留哨兵 `__unassigned__` 并计数上报(**不静默丢弃**,符合 Spec 不虚构精神)。是否改为硬拒绝重问见 **Open-Q4**。

### 4.2 synthesize 改造(`campaignGeminiService.ts:410-465`)

- probeSummary(:420-427)里 `intentGroupId`(:424)改用 `question.dimensionId`。
- prompt 里喂给 LLM 的 `intentGroups`(:440)改为喂"维度化的组"(已是稳定组)。
- synthesis 仍产出 `intentDiagnoses`,但其 `intentGroupId` 现在**等于 dimensionId**;`enrichIntentDiagnoses` 会用维度组覆盖计算(见 4.3),LLM 只贡献 narrative。**S4/S5 是否拆成两次调用属另一刀,本刀不动**(只把分组锚从临时 id 换成 dimension)。

### 4.3 intentMetrics 改造(`intentMetrics.ts:69-94`)

- `enrichIntentDiagnoses` 现在遍历 `preprocess.intentGroups`(:74)——这些组已是稳定维度组,逻辑基本不变。
- 匹配 aiDiag(:75-77)增加按 `dimensionId` 匹配;label 从 framework 解析(用冻结版)而非信任 LLM。
- `computeIntentGroupMetrics`(:14-67)**完全不动**(纯确定性重算,好底子保留)。

### 4.4 probeDelta 改造(`probeDelta.ts`)——对齐锚换成 dimension

- `computeIntentGroupDeltas`(:36-62)遍历 `preprocess.intentGroups`(:42),现在组=稳定维度,天然按维度对齐。改动:`label` 用 `resolveFramework(冻结版)` 取,而非直接用 `ig.label`(防历史标签漂移)。
- `computeProbeDelta`(:14-34)按 questionId 配对——**不动**(问题冻结,questionId 稳定)。
- `buildProgressSnapshot`(:64-101)——**骨架不动**;仅 baseline/current 按 questionId 配对(:82-86)已保证同题同维度对齐。
- 新增防御性断言:配对时若同一 questionId 的 baseline 与 current 的 dimensionId 不一致(冻结后不应发生),`console.warn` 上报——把"意外重聚类"变成可见信号。

### 4.5 复测流程(`campaignPipeline.ts:188-195` + `StepCampaignBlueprint.tsx:88-121`)

- `rerunCampaignProbes` 已复用 `campaign.preprocess.questions`(:193)、**不重跑 preprocess**——本刀确认这是正确行为,不改。
- 附带修:`StepCampaignBlueprint.tsx:91` phase 三元两支都是 `'mid'` 的既存 bug——**不在本刀强制范围**,仅在改动清单标注为"顺手可修",默认不动以缩小 diff。

---

## 5. 改动清单(逐文件,标改动量)

### 新增(2 个文件)
| 文件 | 内容 | 量 |
|---|---|---|
| `src/types/framework.ts` | EngineeringDimension / RepairAction / RootCauseType / IntentFrameworkDefinition | ~40 行 |
| `src/config/intentFramework.ts` | SEMICONDUCTOR_FRAMEWORK_V1 种子(7 维 9 类)+ registry + resolver 函数 | ~140 行 |

### 修改(7 个文件)
| 文件 | 改动 | 量/风险 |
|---|---|---|
| `src/types/campaign.ts` | +SemanticAnchor +IntentCoordinateSystem;SeedQuestion 加 dimensionId、expectedAnchor→anchor、intentGroupId 标 deprecated;Campaign 加 intentFrame;SeedQuestionPreprocessResult 加 framework 冗余字段 | 中 · 类型面广但多为增量 |
| `src/services/campaignGeminiService.ts` | preprocess prompt 去聚类改归类 + schema 加 dimensionId/anchor 去 intentGroups;buildDimensionGroups 组装;synthesize 的 intentGroupId→dimensionId | **高 · 本刀最大逻辑改动**(LLM 契约变了) |
| `src/services/intentMetrics.ts` | +buildDimensionGroups(或放框架模块);enrichIntentDiagnoses 按 dimensionId 匹配 + framework 解析 label | 中 · 核心 compute 不动 |
| `src/services/probeDelta.ts` | 组级 delta 用冻结版 framework 解析 label;+dimension 一致性断言 | 低 · 骨架不动 |
| `src/services/campaignPipeline.ts` | 创建 campaign 时初始化 intentFrame(绑 framework);activeDimensionIds 收集 | 低 |
| `src/store/workflowStore.ts` | +applyFreezeGuard;setCampaign/updateCampaign 接 guard;+freezeIntentFrame action;+setCampaign force 选项;STORAGE_VERSION 3→4 + migrate | **高 · 触及持久化,风险见 §6/§7** |
| `src/components/StepCampaignDiscovery.tsx` | handleConfirm 调 freezeIntentFrame;(可选)重跑冻结确认——见 Open-Q5 | 低-中 |

### 基本不动(确认保留)
- `src/services/multiModelService.ts`、`server.js`(诊断执行轨)——本刀不碰。
- `geminiService.ts` 报告 prompt——**可选**把 expectedAnchor 引用改 anchor.text、根因 label 用 framework 解析;默认最小改动,列 Open-Q6/Q1。
- `types.ts` 的 hub 遗留类型、`GeoFailureCategory` 枚举——不动。
- `StepCampaignBlueprint.tsx` 的 intentGroupId 渲染(:168-181)——因 intentGroupId 现等于 dimensionId,渲染天然可用,不动。

---

## 6. 风险与取舍

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | preprocess LLM 契约改变(聚类→归类):可能有题选不到合适维度、或选非法维度 | 归类质量 / 空维度 | `__unassigned__` 哨兵 + 计数上报,不静默丢;维度描述写足让 LLM 好选;Open-Q4 定是否硬拒绝 |
| R2 | 写保护 strip 策略可能"悄悄丢弃"用户以为生效的改动 | 冻结后编辑无效但无强反馈 | console.warn + 冻结点前移到确认(确认后本就不该改结构);未来加 UI 提示(超本刀) |
| R3 | STORAGE_VERSION 迁移写错 → 旧 campaign 白屏/丢失 | 现存本地数据 | migrate 做**加法式补默认**、失败回退 null(现有 onRehydrate 已有容错 workflowStore.ts:178-188);§7 详列 |
| R4 | intentGroups 语义悄悄从"LLM 聚类"变"维度组",下游若有隐藏假设会错位 | 报告/UI 展示 | 已核查全部 intentGroups/intentGroupId 引用点(§0 grep);id 保持稳定,label 保持字符串,形状兼容 |
| R5 | 冻结版 framework 解析不到(registry 缺该版) | 复测取不到 label | resolveFramework 返回 null 时回退到"用 campaign 内冗余存的 intentGroups label",不阻断;registry 永不删旧版是硬纪律 |
| R6 | 诊断-复测链路回归 | 命脉功能 | 保留 computeIntentGroupMetrics / computeProbeDelta / buildProgressSnapshot 骨架不动;questionId 配对不变;新增仅是"分组锚更稳" |

**核心取舍**:分组的"锚"从 LLM 临时 id 换成 framework 稳定维度,是**收敛性改动**(让对齐更稳),不是重写。凡"好底子"(确定性 compute、反虚构报告、questionId 配对)一律原样保留,改造只在其上换锚 + 加冻结壳。

---

## 7. 迁移(STORAGE_VERSION 3 → 4)

`workflowStore.ts:9` `STORAGE_VERSION = 3` → `4`;`migrate`(:157-167)加 v3→v4 分支。对持久化的单个 campaign 做**加法式补默认**:

1. **intentFrame 缺失** → 注入 `{ frameworkId: DEFAULT_FRAMEWORK_ID, frameworkVersion: DEFAULT_FRAMEWORK_VERSION, frozen: false, activeDimensionIds: [] }`。旧数据一律视为**未冻结**(保守:不追溯冻结一个没有维度绑定的旧 campaign)。
2. **SeedQuestion.dimensionId 缺失** → 回填自 `intentGroupId`(把旧的临时组 id 暂当维度占位),或统一填 `__unassigned__`。**取舍见 Open-Q7**:旧 campaign 的临时组 id 不是合法维度 id,直接映射会污染维度空间;推荐旧问题一律 `__unassigned__` 并在 UI 标"需重建基线",不假装它们已归入新维度。
3. **expectedAnchor → anchor** → `{ text: expectedAnchor ?? '', source: null, claimId: null }`。
4. **intentGroups** 保留原值(旧的仍能渲染);新 campaign 才走维度派生。
5. 迁移失败 → 沿用现有 `onRehydrateStorage` 容错(:178-188)与 `normalizeCampaign` 兜底,最坏回退 `campaign: null`,不白屏。

原则:migration 只补默认、不伪造语义(不把旧临时组冒充成新维度)。这与 Spec §2.3"总控不得补事实"一致。

---

## 8. 待你确认的问题(不自行假设)

| # | 问题 | 我的推荐 |
|---|---|---|
| **Q1** | "锚点不再埋在 prompt"是否包含**停止把 anchor 注入探测 prompt**(campaignGeminiService.ts:375 的 EXPECTED ST ANCHOR)?这正是 GAP"做歪#1 引导性探测",但改它会动诊断输出。 | **本刀只做结构化,不改探测 prompt 注入行为**(避免动诊断链路 + 与"零提示"那一刀重叠)。仅把 synthesis/报告里的 expectedAnchor 引用改指 anchor.text。探测注入留给诊断诚信那一刀。 |
| **Q2** | "维度"与"战略支柱"是同一层还是两层?约束 4 写作"维度/战略支柱"。 | **同一层**:工程维度即对齐支柱(单层锚)。若你要"支柱"作为维度之上的更粗聚合层,请指出,我加一层。 |
| **Q3** | 一个监测问题能否归属**多个**维度? | **单一主维度**(dimensionId 单值)。多归属会让 delta 对齐口径歧义。如需多维,建议"主维度 + tags",但本刀先单值。 |
| **Q4** | LLM 归类给出**非法/无维度**时:哨兵 `__unassigned__` + 上报,还是硬拒绝并重问? | **哨兵 + 上报**(不阻断流程,把问题变可见)。硬拒绝重问更"纯"但增加失败率与延迟。 |
| **Q5** | 重跑 Step 1 覆盖**已冻结** campaign 的交互:hard block / 确认弹窗 / 仅 warn? | **确认弹窗**(触及三语文案,故列此)。数据层先加 force 开关,文案定了再接 UI。 |
| **Q6** | 维度/根因 label 的多语言:i18n map(zh/en/jp)还是单一 canonical + 由 LLM 在输出时本地化? | 本刀**单一中文 canonical**存种子;展示层本地化留后续。若要立刻多语言,我把 label 改成 `{zh,en,jp}` map。 |
| **Q7** | 旧 campaign 迁移时 dimensionId 回填:一律 `__unassigned__`(诚实,标需重建),还是把旧 intentGroupId 当维度占位(不打断旧展示但污染维度空间)? | **一律 `__unassigned__` + 标"需重建基线"**。不把临时组冒充维度。 |

---

## 9. 实施顺序(review 通过后执行,供参考)

1. `types/framework.ts` + `config/intentFramework.ts`(纯新增,零风险,先立地基)。
2. `types/campaign.ts` 类型增量(编译期先对齐)。
3. `intentFramework` resolver + `buildDimensionGroups`(确定性,可单测)。
4. `campaignGeminiService` preprocess/schema/synthesize(最大改动,单独提交)。
5. `intentMetrics` / `probeDelta` 换锚(小改)。
6. `workflowStore` 冻结 guard + migrate(持久化,单独提交 + 手测旧数据)。
7. `campaignPipeline` 初始化 intentFrame + `StepCampaignDiscovery` 冻结点。
8. 全量 `tsc -b` + `npm run build` + 端到端手测(seed→诊断→确认冻结→复测 delta 对齐)。

> 每步小提交,命脉链路(诊断-复测)在第 5、8 步各验一次。
