# REFACTOR-PLAN-02 · M1 诊断诚信刀：真实探测驱动打分

> 状态:**已实施(M1)**。前置:第一刀(意图坐标系框架化 + 冻结对齐)已落地(`36d50d9`)。标尺:`GAP-ANALYSIS.md` §S3 / §E / 做歪#1–3；`docs/campaign-pipeline-master-spec.md` §S3 零提示 + 多次取共性。
> 目标:**工具吐出的每个数字，owner 敢拿去给管理层看**——所有进入打分 / battle-map / delta 的感知字段，必须能溯源到真实被测模型的原始回答。
> 范围纪律:严格遵守四个硬约束；不动第一刀的 framework / 冻结 / 维度对齐；不加 `questionType` 字段。

---

## 0. 现状核实(先说，因为它决定改造落点)

### 0.1 当前探测链路(逐行证据)

```
campaignPipeline.runProbesForQuestions (campaignPipeline.ts:61-118)
  ├─ [所有生态必跑] runGeminiQuestionProbe → GeminiProbeSnapshot → normalizeProbe
  │     写入 QuestionProbe.gemini —— 这是**主数据轨**
  └─ [仅 cn 或 region 命中中国] runMultiModelVerificationForQuestion → multiModel
        写入 QuestionProbe.multiModel —— 仅 consensusLevel 旁路，**不进打分**
```

**打分消费方(全部读 `probe.gemini`，不读 `multiModel`)**:

| 消费方 | 文件 | 读的字段 |
|---|---|---|
| 意图组指标 | `intentMetrics.ts:14-67` | `stMentioned`, `voidSeverity`, `voidSize`, `dominantCompetitors`, `primaryFailure` |
| 复测 delta | `probeDelta.ts:14-62` | 同上 + `stBindingStrength`, `anchorStatus` |
| 综合 prompt | `campaignGeminiService.ts:454-461` | `gemini` 全量 + `multiModelConsensus`(旁路) |
| 报告 prompt | `geminiService.ts:223-248` | `gemini.*` 作主证据；`multiModel` 作独立章节 |
| 基线表 UI | `StepCampaignDiscovery.tsx:286-288` | `gemini.stBindingStrength`, `voidSize`, `competitors` |

**结论**:M1 的核心不是"给 multiModel 加权"，而是**拆掉 `gemini` 模拟轨在打分链路上的地位**，新建「真实响应 → 裁判提取 → 确定性聚合 → `ScoredProbeSnapshot`」轨，并让所有消费方改读新轨。

### 0.2 引导性注入点(全 repo 清查)

| # | 位置 | 注入内容 | 链路 | M1 动作 |
|---|---|---|---|---|
| I1 | `multiModelService.ts:203-208` | `Campaign context: ${topic}` + `Mention specific semiconductor vendors…` | **生产探测** | **删除** |
| I2 | `campaignGeminiService.ts:399-401` | tierHint 点名 `STMicroelectronics (ST)` | 模拟探测 | **整条模拟轨移出打分** |
| I3 | `campaignGeminiService.ts:406-409` | `CAMPAIGN: ${topic}` + `ECOSYSTEM/REGION` | 模拟探测 | 随模拟轨降级 |
| I4 | `campaignGeminiService.ts:409` | `EXPECTED ST ANCHOR (if fairly cited): …` | 模拟探测 | **删除**(anchor 仅进裁判) |
| I5 | `campaignGeminiService.ts:414` | `dominantCompetitors (semiconductor vendors)` | 模拟探测 | 随模拟轨降级 |
| I6 | `multiModelService.ts:180-189` | `runMultiModelVerification`(hub 遗留) 含 seed 引导 | 无调用方 | 标注 `@deprecated`，不动或一并清零 |
| I7 | `server.js:255` | `temperature: 0.3` 固定 | 探测执行 | 保留为默认；N>1 时允许微扰(见 §5) |
| — | `campaignGeminiService.ts:274` | preprocess prompt 写 `semiconductor B2B` | **预处理，非探测** | **本刀不动**(金标验证单独观察) |

**裁判链路允许的"品牌知识"**:裁判 prompt 可携带**被测品牌别名表**(用于从原文中识别 ST 是否被提及)，这是**判卷词典**，不是**考题提示**。必须与探测 prompt 严格分离。

### 0.3 第一刀成果(本刀必须原样保留)

- `src/config/intentFramework.ts` + `src/types/framework.ts` — 不动
- `IntentCoordinateSystem` + `applyFreezeGuard` + `freezeIntentFrame` — 扩展，不重写
- `buildDimensionGroups` / `dimensionId` 对齐 — 不动
- `preprocessSeedQuestions` 的七维归类契约 — 不动(金标只观察)

---

## 1. 裁判链路设计

### 1.1 原则:运动员下场，裁判读成绩单

```
┌─────────────────────────────────────────────────────────────┐
│ S3 执行(零提示)                                              │
│   每题 × 每模型 × N 次 → ModelProbeAttempt[] (原始全文)       │
└──────────────────────────┬──────────────────────────────────┘
                           │ 原文作为唯一输入
┌──────────────────────────▼──────────────────────────────────┐
│ S3.5 裁判(Gemini analysis 模型, responseSchema)              │
│   读全部 transcript → RefereeObservation[] (逐条可溯源)     │
│   禁止: simulate / role-play / 预测 / 补全未出现的竞品         │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ S3.6 聚合(纯代码, intentMetrics 同级)                        │
│   RefereeObservation[] → ScoredProbeSnapshot (频率/众数/波动) │
└─────────────────────────────────────────────────────────────┘
```

**约束 1 判别测试**: `ScoredProbeSnapshot` 每个字段旁挂 `fieldProvenance` 或能通过 `observations[].evidenceQuote` 反查到某条 `attempts[].rawResponse` 的子串。做不到 = 设计不合格。

### 1.2 新增类型(新文件 `src/types/probe.ts`)

```ts
/** 协议版本常量 — 见 config/probeProtocol.ts */
export type ProbeProtocolVersion = 'v1-simulated-guided' | 'v2-real-probe';

/** 单次真实探测的原始证据(不可丢) */
export interface ModelProbeAttempt {
  id: string;              // att-<ts>-<model>-<run>
  modelId: ModelId;
  runIndex: number;        // 0 .. runsPerModel-1
  promptText: string;      // 审计:实际发出的零提示 prompt(截断存)
  rawResponse: string;     // 全文证据(持久化,见 §1.5)
  probedAt: string;
  latencyMs: number;
  error?: string;
}

/** 裁判对单条 transcript 的结构化判读(必须可溯源) */
export interface RefereeObservation {
  attemptId: string;       // → ModelProbeAttempt.id
  modelId: ModelId;
  runIndex: number;
  stMentioned: boolean;
  stBindingStrength: StBindingStrength;
  dominantCompetitors: string[];   // 仅允许填原文出现的名字
  primaryFailure: GeoFailureCategory;
  anchorStatus?: AnchorVerificationStatus;  // 事后对照 SeedQuestion.anchor
  /** 裁判引用的原文片段 — 约束 1 的硬要求 */
  evidenceQuotes: {
    field: 'stMentioned' | 'competitors' | 'failure' | 'anchor';
    quote: string;
  }[];
}

/** 进入打分 / delta / 报告主轨的聚合快照 */
export interface ScoredProbeSnapshot {
  protocolVersion: ProbeProtocolVersion;
  runsPerModel: number;
  modelsProbed: ModelId[];
  attempts: ModelProbeAttempt[];
  observations: RefereeObservation[];
  // ── 聚合字段(代码算,不信裁判口述的汇总) ──
  stMentionCount: number;
  stMentionRate: number;          // count / successfulAttempts
  stBindingStrength: StBindingStrength;
  voidSeverity: number;
  voidSize: VoidSize;
  dominantCompetitors: { name: string; mentionCount: number }[];
  primaryFailure: GeoFailureCategory;
  anchorStatus?: AnchorVerificationStatus;
  volatility: 'stable' | 'mixed' | 'sparse';  // 跨次波动信号
  successfulAttempts: number;
  failedAttempts: number;
  refereeModel: string;
  scoredAt: string;
}
```

### 1.3 `QuestionProbe` 改动(`types/campaign.ts`)

```ts
export interface QuestionProbe {
  // ...现有字段...
  /** @deprecated v1 模拟轨 — v2 campaign 不得写入打分链路 */
  gemini?: GeminiProbeSnapshot;
  /** v2 主轨:真实探测 + 裁判 + 聚合 */
  scored?: ScoredProbeSnapshot;
  multiModel?: MultiModelVerificationResult;  // @deprecated 本刀后由 scored.attempts 取代
}
```

过渡期:`gemini` 保留只读，供 v1 旧 campaign 渲染；**v2 新跑的 probe 只写 `scored`**。

### 1.4 裁判 prompt 设计(新文件 `src/services/probeReferee.ts`)

**输入(每题一次调用)**:
- `questionText`(冻结原文)
- `anchor?: SemanticAnchor`(仅用于 `anchorStatus` 判卷，**不出现在被测模型 prompt 里**)
- `brandAliases: string[]`(来自 `config/probeProtocol.ts` 的 ST 别名表，如 `STMicroelectronics`, `ST`, `意法半导体`, `STM32`…)
- `transcripts: { attemptId, modelId, runIndex, rawResponse }[]`

**输出 schema(JSON, `GEMINI_MODELS.analysis`)**:
- `observations[]` 与 `RefereeObservation` 同构
- 强制 `evidenceQuotes` 非空(除 `error` 的 attempt 可跳过)

**铁律(写入 prompt)**:
1. You are a **referee reading transcripts**, NOT simulating answers.
2. Extract ONLY entities/phrases that **literally appear** in the transcript.
3. If ST is not mentioned, `stMentioned=false` — do not infer from category knowledge.
4. `dominantCompetitors` must be verbatim names from text; empty array if none.
5. `anchorStatus` compares anchor.text against transcript content only.

**失败处理**:裁判 JSON 解析失败 → 1 次 repair(现有 `parseJson` 模式) → 仍失败则该题 `scored` 标 `degraded: true`，**指标字段留空/零，禁止 normalizeProbe 式静默补值**(对齐 Spec §2.3 方向)。

### 1.5 原始响应存储方案(localStorage 取舍)

| 方案 | 做法 | 估容(10题×4模型×N=2×500字) | 结论 |
|---|---|---|---|
| A. 全文存 localStorage | `attempts[].rawResponse` 不截断(上限 8KB/条) | ~160KB/campaign | **推荐 M1 默认** |
| B. 分层截断 | persist 时 raw 截 4000 字，内存保留全文 | ~80KB | 备选:成本敏感 |
| C. IndexedDB 外置 | 大文本进 IDB，localStorage 只存 id 引用 | 几乎无限 | **顺延** — M1 不加复杂度 |

**现有瘦身逻辑冲突**: `workflowStore.serializeCampaign` 当前截 `gemini.simulatedAnswer` 到 2000 字(`workflowStore.ts:167-172`)。M1 改为:
- v2 `scored.attempts[].rawResponse`:**不截断**(或上限 8000)，这是证据链
- v1 `gemini.simulatedAnswer`:维持 2000 截断(旧数据)

**容量预警**:localStorage 典型上限 ~5MB。单 campaign ~200KB 量级安全；若用户反复重跑覆盖式存储(单 slot)不构成问题。UI 报告导出时可引用全文。

### 1.6 聚合规则(新文件 `src/services/probeAggregation.ts` — 纯确定性)

输入:`RefereeObservation[]` + `runsPerModel` + `modelsProbed`

| 输出字段 | 规则 | 理由 |
|---|---|---|
| `stMentionCount` | `observations.filter(o => o.stMentioned).length` | 直观频率分子 |
| `stMentionRate` | `stMentionCount / successfulAttempts` | 约束 3:"提及频率 x/N"推广到跨模型 |
| `stBindingStrength` | `none`: rate=0; `weak`: 0<rate<0.5; `strong`: rate≥0.5 且众数 binding 为 strong | 单次孤例不会直接 strong |
| `voidSeverity` | 确定性公式(见下) | 保留与现 UI 热图兼容的 1–10 |
| `voidSize` | 由 severity 映射(复用现 `normalizeProbe` 阈值) | 减少 UI churn |
| `dominantCompetitors` | 跨 observation 计次排序;只保留出现≥2次或最高频 | 过滤单次孤例 |
| `primaryFailure` | 众数;平票取 severity 更高者 | 可解释 |
| `volatility` | 同模型 N 次 stMentioned 不一致 → `mixed`; 成功<4 → `sparse`; 否则 `stable` | 约束 3 波动信号 |
| `anchorStatus` | 跨 observation 的 anchorStatus 众数 | 事后判卷聚合 |

**voidSeverity 公式(M1 默认,可配置)**:

```
base = stMentioned ? (binding===strong ? 2 : binding===weak ? 5 : 7) : 8
competitorBoost = min(2, dominantCompetitors[0]?.mentionCount >= 3 ? 2 : 1)
severity = clamp(base + (stMentionRate < 0.25 ? competitorBoost : 0), 1, 10)
```

> 这是**阈值默认裁决**,不是 LLM 打分。后续可接 decision-log 过门;M1 先代码算。

**不调用 `normalizeProbe`**:M1 的 `probeAggregation` 自建互锁逻辑，或抽取 `normalizeProbe` 中**与模拟无关**的 severity↔voidSize 映射为共享函数——但输入必须来自聚合频率，不是 Gemini 自评。

---

## 2. 探测链路改动

### 2.1 零提示 prompt 定稿

新函数 `buildZeroHintProbePrompt(questionText, uiLang): string`

```
${langHint}   // 仅语言: "请用中文回答。" / "Please answer in English."
${questionText}
```

**删除的参数**: `campaignTopic`, `ecosystem`, `region`, `tier`, `anchor`, 一切品牌/行业/厂商引导。

**长度**: `questionText.slice(0, 800)` — 与现 CN 500 相比略放宽，防截断断意。

### 2.2 多次调用与并发模型

新函数 `runRealProbesForQuestion(question, opts): ModelProbeAttempt[]`

```
opts = { runsPerModel: N, uiLang, onAttemptComplete? }

for runIndex in 0..N-1:
  parallel( deepseek, qwen, doubao, kimi )  // 4 并发
  → 4 attempts
// 共 N×4 attempts / 题
```

**改动 `multiModelService.ts`**:
- `runMultiModelVerificationForQuestion` → 重命名为 `runZeroHintProbes`(或保留名但换实现)
- 新增 `runSingleModelProbe(modelId, prompt, runIndex)` — 复用 `callViaProxy`
- 删除 I1 注入;删除 `analyseConsensus` 在打分链路的地位(可保留作 diagnostic 日志，不写 `ScoredProbeSnapshot`)

**改动 `campaignPipeline.ts:runProbesForQuestions`**:

```diff
- const gemini = await runGeminiQuestionProbe(...)
- let multiModel; if (runCnMulti) { multiModel = await run... }
- probes.push({ gemini, multiModel })

+ if (!runCnMulti) { /* §4 global 处理 */ }
+ const attempts = await runZeroHintProbes(q, { runsPerModel, uiLang })
+ const observations = await refereeExtractObservations(q, attempts, brandAliases)
+ const scored = aggregateProbeScore(attempts, observations, { runsPerModel, protocolVersion })
+ probes.push({ scored })
```

**删除**:该函数内对 `runGeminiQuestionProbe` 的调用。

**`runGeminiQuestionProbe` 处置**:保留函数 + 标 `@deprecated` + 移入 `legacy/` 或文件末尾，**pipeline 零引用**。防止"为了方便"被重新接回。

### 2.3 进度反馈

扩展 `CampaignPipelineProgress`:

```ts
detail?: string;           // "Probing Q3/10 · DeepSeek run 2/2"
completedQuestions?: number;
totalQuestions?: number;
completedAttempts?: number;   // 新增
totalAttempts?: number;       // questions × models × N
currentStage?: 'execute' | 'referee' | 'aggregate';
```

`PipelineStageIndicator` 可选加 `referee_score` stage(或并入 `probe_questions` 子状态) — **最小 UI**:只更新 detail 文案。

### 2.4 配置项(新文件 `src/config/probeProtocol.ts`)

```ts
export const PROBE_PROTOCOL_V1 = 'v1-simulated-guided';
export const PROBE_PROTOCOL_V2 = 'v2-real-probe';
export const CURRENT_PROBE_PROTOCOL = PROBE_PROTOCOL_V2;
export const DEFAULT_RUNS_PER_MODEL = 2;

export const ST_BRAND_ALIASES = [
  'STMicroelectronics', 'STMicro', 'ST', '意法半导体', '意法',
  // ...owner 确认后扩充
];

export interface ProbeProtocolConfig {
  version: ProbeProtocolVersion;
  runsPerModel: number;
}
```

---

## 3. 协议版本机制

### 3.1 落点(绑在 `IntentCoordinateSystem` 上,与 frameworkVersion 同款)

扩展 `types/campaign.ts` 的 `IntentCoordinateSystem`:

```ts
export interface IntentCoordinateSystem {
  frameworkId: string;
  frameworkVersion: string;
  frozen: boolean;
  frozenAt?: string;
  activeDimensionIds: string[];
  // ── M1 新增 ──
  probeProtocolVersion: ProbeProtocolVersion;
  probeRunsPerModel: number;    // 冻结时记录实际 N
}
```

- **创建时**(`campaignPipeline.ts`):写入 `CURRENT_PROBE_PROTOCOL` + `DEFAULT_RUNS_PER_MODEL`
- **冻结时**(`freezeIntentFrame`):`probeProtocolVersion` / `probeRunsPerModel` 随 `intentFrame` 一起定格
- **写保护**(`applyFreezeGuard`):已含整个 `intentFrame` 的 strip — 无需额外规则

### 3.2 旧数据标记

| 来源 | `probeProtocolVersion` 回填 |
|---|---|
| v4 persist 无字段 | `v1-simulated-guided` |
| 有 `probe.gemini` 无 `probe.scored` | `v1-simulated-guided` |
| M1 新跑 | `v2-real-probe` |

### 3.3 跨协议警告(触发位置)

| 位置 | 行为 |
|---|---|
| `probeDelta.buildProgressSnapshot` | 若 baseline 与 current 的 `intentFrame.probeProtocolVersion` 不同 → `console.warn` + snapshot 加 `protocolMismatch: true` |
| `probeDelta.computeProbeDelta` | 协议不一致时**不算数值 delta**,只保留 `questionText` 对齐信息 |
| `StepCampaignBlueprint` 复测 UI | 若 mismatch → 展示横幅「⚠ 探测协议已升级(v1→v2)，跨协议不可比，请重建基线」 |
| `geminiService.buildCampaignReportPrompt` | 注入 `PROTOCOL WARNING` 段落，禁止 LLM 把 v1/v2 数字放在一起趋势分析 |

**铁律**:改测法 = 新协议 = 重建基线。不得静默混算。

---

## 4. global 生态处理

### 4.1 选项对比

| 选项 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **(a) 非 CN 禁止可信打分** | `!runCnMulti` 时跳过 execute+referee;`scored=null`;campaign `status` 标 `insufficient_ecosystem`;UI 明确「仅 CN/中国区支持真实探测」 | 最诚实;零模拟污染 | global/jp/kr 用户暂时无法出分 |
| (b) 模拟显式降级 | 保留 `runGeminiQuestionProbe` 产出,标 `simulationOnly: true`,不进 delta/指标 | demo 友好 | 极易渗回主轨;与约束 1 冲突风险高 |
| (c) 接全球模型 API | 加 OpenAI/Claude 等 | 真正全球 | 超出 M1 范围;密钥/合规 |

### 4.2 推荐:**(a) 非 CN 禁止可信打分**

理由:
1. 约束 1 写死「模拟即失真」— 没有真实被测模型就没有成绩单给裁判读。
2. 当前 server 只代理 CN 四模型;硬凑 global 模拟违背 M1 标志。
3. (b) 在工程上极难防止「某个消费方忘了检查 flag」— GAP 已证明旁路信号会被忽略一次。

**M1 具体行为**:
- `ecosystem !== 'cn' && !regionIsCn` → 不调用任何被测模型
- `QuestionProbe.scored` 为 `undefined`;附 `probeSkipReason: 'ecosystem_not_supported'`
- 基线表 UI 显示「需要 CN 生态」而非空分
- preprocess + synthesis **仍可跑**(用空/降级诊断),但 `intentMetrics` 检测到无 scored 时 metrics 全零 + `degraded` 旗标
- 报告 prompt 注入「无真实探测 — 不得输出定量诊断」

**后续**(非 M1):接全球探测 API 时升 `v3-global-probe` 协议,不与 v2 混比。

---

## 5. 成本与可靠性

### 5.1 调用量估算

| 场景 | 公式 | N=2 默认 | N=3 |
|---|---|---|---|
| 基线探测 | `Q × 4模型 × N` | 10×4×2 = **80** | 120 |
| 裁判 | `Q × 1` | **10** | 10 |
| 复测一轮 | 同上 | **80** | 120 |
| **单 campaign 全周期(基线+1次复测)** | | **170 CN + 20 Gemini** | 250+20 |

### 5.2 并发 / 限速策略

**客户端(`multiModelService.ts`)**:
- 单题内:4 模型 `Promise.all`(保持)
- 题间:串行(`for` 循环保持) — 天然限流
- N 次:题内串行 runIndex(防同一模型并发打满)

**服务端(`server.js`)** — 轻量增强,不重构:
- 可选:每 `modelId` 滑动窗口最多 2 并发(简单 `Map<modelId, Semaphore>`)
- `POST /api/multi-model-probe` 接受可选 `temperature`(默认 0.3;N>1 时客户端传 0.4 增加采样多样性 — **可配置,默认不动**)
- 502/429 → 1 次指数退避重试(2s)

### 5.3 部分失败处理

| 情况 | 行为 | 禁止 |
|---|---|---|
| 单模型单次失败 | `attempt.error` 记录;不计入 `successfulAttempts` | 静默补零响应 |
| 单题成功<2 attempts | `volatility='sparse'`;`voidSeverity` 仍可算但 UI 标「样本不足」 | 假装 N 完整 |
| 单题成功=0 | `scored.degraded=true`;metrics 空;不阻断整轮 | normalizeProbe 补假分 |
| 裁判失败 | 该题 degraded;其余题继续 | 回退到 gemini 模拟 |

**缺口显式记录**: `ScoredProbeSnapshot.failedAttempts` + 报告章节列出 `modelId/runIndex/error`。

---

## 6. 改动清单(逐文件)

### 新增(4 文件)

| 文件 | 内容 | 量 |
|---|---|---|
| `src/types/probe.ts` | `ModelProbeAttempt`, `RefereeObservation`, `ScoredProbeSnapshot`, `ProbeProtocolVersion` | ~90 行 |
| `src/config/probeProtocol.ts` | 协议常量、ST 别名表、默认 N | ~40 行 |
| `src/services/probeReferee.ts` | 裁判 prompt + schema + `refereeExtractObservations` | ~120 行 |
| `src/services/probeAggregation.ts` | 频率/众数/voidSeverity 确定性聚合 | ~100 行 |

### 修改(10 文件)

| 文件 | 改动 | 量/风险 |
|---|---|---|
| `src/types/campaign.ts` | `QuestionProbe` 加 `scored`;`gemini` 改 optional+deprecated;`IntentCoordinateSystem` 加协议字段;`CampaignProgressSnapshot` 加 `protocolMismatch?` | 中 |
| `src/services/multiModelService.ts` | 零提示 prompt;N 次调用;拆 `runZeroHintProbes` | **高 · 探测执行核心** |
| `src/services/campaignPipeline.ts` | 换探测链;去 `runGeminiQuestionProbe`;CN 门禁;初始化协议字段 | **高 · 编排命脉** |
| `src/services/campaignGeminiService.ts` | `runGeminiQuestionProbe` 标 deprecated 移出 pipeline;synthesis `probeSummary` 改读 `scored` | 中 |
| `src/services/intentMetrics.ts` | `computeIntentGroupMetrics` 改读 `scored` 聚合字段 | **高 · 指标命脉** |
| `src/services/probeDelta.ts` | 改读 `scored`;跨协议警告 | **高 · 复测命脉** |
| `src/services/geminiService.ts` | 报告 prompt 主证据从 `gemini` → `scored`;协议/样本量/N 注入 | 中 |
| `src/store/workflowStore.ts` | STORAGE_VERSION 4→5;迁移协议字段;serialize 策略(§1.5) | **高 · 持久化** |
| `src/components/StepCampaignDiscovery.tsx` | 基线表读 `scored`;显示 `mentionRate (k/N)`、协议版本 | 低-中 |
| `server.js` | 可选重试 + 并发注释/轻量 semaphore | 低 |

### 可选最小改动(2 文件)

| 文件 | 改动 |
|---|---|
| `src/components/StepCampaignBlueprint.tsx` | 复测前协议检查横幅;修 `:91` phase bug(顺手) |
| `src/i18n/translations.ts` | 协议/样本不足/跨协议警告 三语文案(最少 6 个 key) |

### 明确不动(好底子)

- `src/config/intentFramework.ts` / `src/types/framework.ts`
- `applyFreezeGuard` / `freezeIntentFrame` / `buildDimensionGroups` 核心逻辑
- `preprocessSeedQuestions` prompt 与 schema
- `server.js` Gemini 代理、`/api/fetch-url`
- `ReportModal.tsx` 大改 — 报告内容来自 `geminiService` prompt 已足够

---

## 7. 迁移(STORAGE_VERSION 4 → 5)

`workflowStore.ts` `STORAGE_VERSION = 5`;`migrate` 加 v4→v5:

1. **`intentFrame.probeProtocolVersion` 缺失** → `'v1-simulated-guided'`
2. **`intentFrame.probeRunsPerModel` 缺失** → `1`(旧版实质单次)
3. **`QuestionProbe`**:有 `gemini` 无 `scored` → 保持原样(只读 legacy);不伪造 `scored`
4. **不追溯重算** — v1 数据不会被"升级"成 v2 分

原则与第一刀一致:**只补默认,不伪造语义**。

---

## 8. 验证方案

### 8.1 构建与类型

- `npm run build` + `npx tsc -b`(允许既有 `ReportModal` 遗留)
- grep 确认 `runGeminiQuestionProbe` 在 `campaignPipeline` 零引用

### 8.2 约束回归(必做)

| # | 测试 | 通过标准 |
|---|---|---|
| T1 | 零提示 | 抓包 `/api/multi-model-probe` 的 prompt 不含 topic/ST/vendor/anchor |
| T2 | 溯源 | 每题 `scored.dominantCompetitors[0]` 能在某 `attempts[].rawResponse` 中找到子串 |
| T3 | 频率 | N=2 时 UI/字段显示 `stMentionRate` 为 0/0.5/1.0 之一(±模型数归一) |
| T4 | 协议 | v1 campaign 复测后 `protocolMismatch=true` 且 delta 无数值 |
| T5 | global | ecosystem=global 时无 `/api/multi-model-probe` 调用,UI 有门禁提示 |
| T6 | 失败 | 手动断一模型 key → 该 attempt 有 error,整题仍出 degraded 分而非 crash |
| T7 | 冻结 | 第一刀冻结后复测,dimensionId 对齐不变(回归) |

### 8.3 端到端

`seed(10题,CN) → 基线 → 确认冻结 → 复测 → 报告` — 全程无 `gemini` 写入新 probe。

### 8.4 金标归类验证(随 M1 接通真实 key 后执行,不改模型)

**目的**:观察第一刀 preprocess 七维归类在真实 API 下的行为,**只出报告,不改数据模型**。

**基准集:SDV 十题**(9 题金标明确 + 1 题见 Open-Q1)

| ID | 题目(摘要) | 金标 `dimensionId` | 题型 |
|---|---|---|---|
| Q1 | ECU 软件迁移 | `migration-compat` | 决策题 |
| Q2 | zonal 是什么 | `__unassigned__` | 格局题 |
| Q3 | 域控 vs ZCU | `__unassigned__` | 格局题 |
| Q4 | 降线束配电成本 | `cost-performance` | 决策题 |
| Q5 | ZCU 厂商 | `__unassigned__` | 格局题 |
| Q6 | PDU 器件 | `__unassigned__` | 格局题 |
| Q7 | PRS 是什么 | `__unassigned__` | 格局题 |
| Q8 | SDV 配电方案 | `__unassigned__` | 格局题 |
| Q9 | eFuse 供应商 | `__unassigned__` | 格局题 |
| Q10 | (见 Open-Q1) | 待定 | — |

**执行步骤**:
1. 新增脚本 `scripts/golden-dimension-check.mjs`(或 `check-dimensions.ts`) — **仅 M1 实施后作为验证工具,本方案阶段只写步骤**
2. 调 `preprocessSeedQuestions(topic, questions, 'zh', 'cn', '中国', DEFAULT_FRAMEWORK)`
3. 逐题输出:`questionText | LLM dimensionId | 金标 | match? | 是否落哨兵`
4. 汇总指标:
   - 决策题命中率(目标 2/2)
   - 格局题哨兵率(目标 **≈7/7 落 `__unassigned__` 是诚实**;低哨兵率=硬塞维度,要警惕)
   - 非法 dimensionId 数(目标 0)

**观察报告模板**(写入 `docs/golden-dimension-observation-YYYYMMDD.md`):
- 逐题表
- 失败模式归类(张冠李戴 / 硬塞最近维度 / 合法歧义)
- 对 Q4 策略建议:维持现状哨兵 vs preprocess prompt 显式写「格局题请选 `__unassigned__`」

**预期校准(反直觉)**:哨兵命中率 ~78%(7/9 格局)是**好结果**;若 LLM 把 PRS/eFuse 硬塞进 `cost-performance`,反而要开 bug。

---

## 9. 风险与取舍

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 调用量 ×N 导致慢/贵 | 用户体验;Cloud Run 账单 | 默认 N=2;进度条显 attempt 计数;题间串行天然限流 |
| R2 | 裁判幻觉竞品名 | 假分 | `evidenceQuotes` 强制 + 聚合前代码校验 quote ⊆ rawResponse |
| R3 | localStorage 膨胀 | 存不下 | 8KB/条上限;单 campaign slot;远期 IDB |
| R4 | 消费方漏改仍读 `gemini` | 旧轨渗回 | TS 层 `scored` required for v2;grep CI 检查 |
| R5 | global 用户突然不能打分 | 支持投诉 | UI 明确原因 + 文档;非 CN 本就不该信 |
| R6 | v1→v2 复测混淆 | 错误决策 | `protocolMismatch` 硬警告 + 不算 delta |
| R7 | voidSeverity 新公式与旧报告口径不一 | 历史对比 | 协议版本标记;报告注脚 |

**核心取舍**:放弃「所有生态都能立刻出分」,换取「CN 生态出的分是实的」。与 M1 标志一致。

---

## 10. 实施顺序(review 通过后)

1. `types/probe.ts` + `config/probeProtocol.ts`(零风险地基)
2. `multiModelService` 零提示 + N 次(可独立手测单题)
3. `probeReferee` + `probeAggregation`(可 mock attempts 单测)
4. `campaignPipeline` 换链(最大改动,单独提交)
5. `intentMetrics` + `probeDelta` 改读 `scored`(命脉,单独提交)
6. `workflowStore` 迁移 + serialize 策略
7. `geminiService` 报告 + UI 最小适配
8. 全量验证 §8 + 金标观察 §8.4

> 第 4、5、8 步各做一次端到端回归。

---

## 11. 待确认问题(不自行假设)

| # | 问题 | 我的推荐 |
|---|---|---|
| **Q1** | SDV 十题基准集第 10 题是什么?上表 Q1–Q9 之外尚缺 1 题金标。 | Owner 补全第 10 题文本 + 期望 dimensionId |
| **Q2** | `DEFAULT_RUNS_PER_MODEL` 默认 **2 还是 3**? | **2**(成本/信号平衡);UI 暴露配置留后续 |
| **Q3** | global 生态:(a)硬禁止 是否接受? | **接受** — 见 §4.2 |
| **Q4** | 裁判:每题 1 次调用(读 N×4 条 transcript) vs 每 attempt 1 次 | **每题 1 次**(省 75% 裁判调用);单次 prompt ≤32k token 够装 8 条×500 字 |
| **Q5** | `ST_BRAND_ALIASES` 初始表谁维护?是否含产品线(STM32/STM8)? | 先最小集(`STMicroelectronics`/`ST`/`意法半导体`);产品线**不加**以免宽判 |
| **Q6** | N 次探测是否调高 temperature(0.3→0.5)? | **M1 保持 0.3**;若波动信号不足再开 Open-Q |
| **Q7** | v1 旧 campaign 在 UI 上如何展示? | 基线表保留读 `gemini` + 角标「旧协议·模拟数据·仅供参考」 |
| **Q8** | 金标验证:preprocess prompt 要不要加「格局题请选 unassigned」? | **M1 不加**(观察真实行为);若哨兵率<50%再开 prompt 刀 |
| **Q9** | `runGeminiQuestionProbe` 是否彻底删除还是仅 deprecated? | **deprecated 保留一版**,pipeline 零引用,6 个月后删 |
| **Q10** | 复测时 N 或协议与基线不同? | **冻结时定格**;复测沿用 `intentFrame.probeRunsPerModel`,不允许单轮覆写 |

---

## 12. 一句话摘要

M1 把诊断链路从「Gemini 模拟自评 + CN 旁路」改成「CN 四模型零提示多次探测 → Gemini 只当裁判读成绩单 → 代码按频率聚合」;用 `probeProtocolVersion` 把旧测法封进历史,跨协议禁止混算 delta。global 生态诚实地不支持打分。第一刀的维度冻结与对齐机制原封不动。
