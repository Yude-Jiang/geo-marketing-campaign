# CURRENT-STATE — geo-marketing-campaign 现状地图

> Audit Phase 0 产出:只描述、不评判。快照基于 branch `claude/campaign-pipeline-spec-gfvqqa` @ `beb28b0`(2026-07-04)。
> 后续 Phase 以 `docs/campaign-pipeline-master-spec.md`(MASTER SPEC v1.1)为标尺对照本文档。

---

## 1. 项目结构与技术栈

### 1.1 目录树(核心部分)

```
geo-marketing-campaign/
├── server.js                     # Express 服务端(唯一后端文件,~300 行)
├── index.html                    # SPA 入口(引 /config.js + /src/main.tsx)
├── check.mjs                     # Puppeteer 截图冒烟脚本(开发工具)
├── testApi.mjs                   # Gemini API 连通性手工测试脚本
├── test-search.ts / test-search2.ts  # Gemini search-grounding 手工实验脚本(未被 app 引用)
├── Dockerfile / cloudbuild.yaml  # Cloud Run 容器化与 Cloud Build 配置
├── .github/workflows/deploy-cloud-run.yml  # push main → Cloud Run 部署
├── docs/
│   ├── campaign-pipeline-master-spec.md   # MASTER SPEC v1.1(audit 标尺)
│   ├── deploy-cloud-shell.md
│   └── deploy-github-cloud-run.md
├── GEO_HUB_CLAUDE_CODE_TASKS_REVISED.md   # 上一轮(hub 时代)修复任务清单存档
└── src/
    ├── App.tsx                   # 顶层布局:header + 2 步向导 + footer + 悬浮 Chat
    ├── main.tsx
    ├── components/
    │   ├── StepCampaignDiscovery.tsx   # 步骤1:输入 → 跑流水线 → 基线表
    │   ├── StepCampaignBlueprint.tsx   # 步骤2:意图诊断 + playbook 选择 + 复测 + 报告
    │   ├── ReportModal.tsx             # 报告渲染/导出(1259 行,含 MD→HTML 转换器)
    │   ├── PipelineStageIndicator.tsx  # 流水线阶段进度条
    │   ├── ChatAssistant.tsx           # 悬浮聊天助手
    │   └── AppErrorBoundary.tsx
    ├── services/
    │   ├── campaignPipeline.ts         # 流水线编排(preprocess→probe→synthesize)
    │   ├── campaignGeminiService.ts    # Gemini 三段调用 + JSON schema + 归一化
    │   ├── geminiService.ts            # Gemini 代理客户端 + 重试 + 报告 prompt
    │   ├── multiModelService.ts        # CN 四模型探测 + 实体/情感/共识分析
    │   ├── intentMetrics.ts            # 意图组指标的确定性计算
    │   └── probeDelta.ts               # 复测 delta 的确定性计算
    ├── store/workflowStore.ts          # Zustand + persist(localStorage)
    ├── types.ts                        # 旧 hub 继承类型(playbook/failure 分类学等)
    ├── types/campaign.ts               # campaign 流水线四层类型契约(328 行)
    ├── types/gemini.d.ts
    ├── config/models.ts                # Gemini 模型名映射(5 个用途槽位)
    └── i18n/translations.ts            # zh / en / jp 三语 UI 文案
```

### 1.2 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 8 + Tailwind CSS 4 + Zustand 5(persist)+ lucide-react + react-markdown |
| 后端 | Node.js + Express 4(单文件 `server.js`),helmet 安全头 |
| LLM SDK | `@google/genai`(服务端);CN 模型走 OpenAI-compatible REST |
| 部署 | Docker → Google Cloud Run(GitHub Actions / Cloud Build / Cloud Shell 三条路径);密钥在 GCP Secret Manager |
| 测试 | 无自动化测试框架;有 3 个手工 API 实验脚本 + 1 个 Puppeteer 截图脚本 |

### 1.3 前后端划分

- **后端(server.js)只做 4 件事**:① Gemini 代理(`/api/gemini/generate` + `generate-stream` SSE);② CN 四模型代理(`/api/multi-model-probe`,key 服务端持有);③ URL 抓取代理(`/api/fetch-url`,经 Jina Reader `r.jina.ai`,带私网地址黑名单);④ 静态托管 `dist/` + SPA fallback + `/healthz`。
- **所有业务逻辑在浏览器端**:流水线编排、prompt 构造、指标计算、delta 计算、报告生成请求全部发生在前端 services 层;服务端不理解任何业务语义,纯转发。

### 1.4 数据存储方式

- **无数据库、无服务端存储、无文件持久化。**
- 唯一持久层是浏览器 `localStorage`(Zustand persist,key = `geo-campaign-storage`,版本号 3,带 migrate)。
- 存的内容:单个 `Campaign` 聚合对象(含全部 probes、synthesis、progressSnapshots)+ UI 状态(语言、生态、当前步骤、选中 playbook、最近 20 条聊天记录)。
- 写入时做瘦身:每条 probe 的 `simulatedAnswer` 截断到 2000 字符。
- **同一时间只保存一个 campaign**——新跑一个会覆盖旧的;无 campaign 列表、无多项目并存、无导出/导入(报告本身可导出 MD/HTML 文件)。

---

## 2. 已实现的功能模块(逐个)

| # | 模块 | 一句话说明 |
|---|---|---|
| 1 | **Campaign 输入(Step 1 上半)** | 用户填 topic(必填)+ 种子问题(可选,一行一个)+ 参考 URL(可选)+ 区域 + 时长(30d/90d/季度/180d/365d),选生态(global/cn/jp/kr)和 UI 语言(zh/en/jp)。 |
| 2 | **种子问题预处理** | Gemini 把用户问题分类(category/sub_node 两档)、聚成 2–4 个意图组、标 P0/P1/P2、推断 expectedAnchor;用户没给问题时由 AI 生成 6–8 个。 |
| 3 | **逐题 Gemini 认知探测** | 对每个问题让 Gemini 角色扮演"今天的 AI 会怎么答",输出结构化快照:ST 是否被提及、绑定强度、真空大小/严重度(1–10)、主导竞品、八类失败归因;之后有一层确定性归一化函数消除自相矛盾的打分。 |
| 4 | **CN 四模型真实探测** | 生态=cn(或 region 命中中国)时,同一问题并行真实调用 DeepSeek/Qwen/Doubao/Kimi,正则抽实体、关键词判情感、按实体重叠率+情感一致性算共识级别(full/partial/divergent/insufficient)。 |
| 5 | **Campaign 综合(synthesis)** | Gemini 基于全部探测数据一次性生成:brief(目标/受众/offer/市场/GEO KPI/时间线/渠道建议/预算档)、每意图组诊断叙事、4–8 张 playbook、执行摘要、创新玩法;JSON schema 约束 + 解析失败先修复重试、再失败标 `degraded` 降级。 |
| 6 | **意图组指标兜底计算** | `intentMetrics.ts` 从探测数据确定性重算 ST 提及率、平均真空严重度、critical 数、主导竞品、主失败类——不信任 LLM 算的数字。 |
| 7 | **基线确认页(Step 1 下半)** | 展示执行摘要、意图组标签、逐题基线表(tier/ST 绑定/真空/竞品),用户点确认进入 Step 2。 |
| 8 | **Blueprint 页(Step 2)** | 意图组诊断卡(可展开叙事)+ playbook 卡片勾选(默认选中非 L 档)+ 创新玩法列表。 |
| 9 | **复测(re-probe)** | 一键用冻结的原题重跑探测(phase=mid),确定性算逐题 delta(绑定/真空/竞品/失败类变化)和意图组 delta,Gemini 写 2–3 段进展叙事,存为 progressSnapshot。 |
| 10 | **报告生成** | Gemini 流式生成双格式报告(MD + HTML body,10 个强制章节),prompt 里内嵌大量反虚构铁律(档案号/日期/模型名由代码算好、四模型章节按真实数据状态三分支渲染、degraded 时强制警示横幅);前端后处理成信息图风格,iframe 预览,可下载 MD 或独立 HTML。 |
| 11 | **聊天助手** | 悬浮窗,把当前 campaign 摘要塞进 system instruction 的通用 Gemini 问答。 |
| 12 | **三语 UI** | zh/en/jp 全量翻译文案(769 行)。 |
| 13 | **运维配套** | Cloud Run 部署三条路径、Secret Manager 拉密钥、健康检查、构建产物校验(dist 缺失即 fail-fast)。 |

**继承自 geo-strategic-hub 但当前无 UI 入口的能力**:`src/types.ts` 里保留了 hub 的完整类型体系(AnalysisResult、IntentCluster、CompetitorInsight、RoleSpecificSop、锚点验证、RAG 证据评分等);`multiModelService.runMultiModelVerification`(按 seed 关键词而非 campaign 问题探测)仍导出但无调用方;`ModelVerificationResult`(Google Search 验证 Gemini 断言)只在类型层挂着,无实现调用。

---

## 3. 数据模型

### 3.1 四层核心链(types/campaign.ts,注释自述)

```
SeedQuestion → QuestionProbe → IntentGroupDiagnosis → CampaignSynthesis
```

**Campaign(聚合根,persisted)**
- `id`(`camp-<timestamp>`)、`topic`、`status`(draft→preprocessing→probing→synthesizing→ready→active→completed)、`duration`、`ecosystem`、`region`、`uiLang`
- `input: CampaignCreateInput`(topic 必填,其余可选)
- `preprocess?: SeedQuestionPreprocessResult`
- `probes: QuestionProbe[]`(时间序列,按 phase 过滤)
- `synthesis?: CampaignSynthesis`
- `progressSnapshots?: CampaignProgressSnapshot[]`
- `reportGeneratedAt?`

**SeedQuestion**:`id / text(冻结原文,注释明确"frozen for reproducible T0/T+N re-probes")/ tier(category|sub_node)/ intentGroupId / priority(P0-P2)/ expectedAnchor? / parentCategoryId?`

**QuestionProbe**(一题×一时点):`phase(baseline|mid|end|ad_hoc)/ probedAt / questionText(探测时冗余快照)/ gemini: GeminiProbeSnapshot / multiModel?: MultiModelVerificationResult / modelVerification?(类型在、无实现)`

**GeminiProbeSnapshot**:`simulatedAnswer / marketPulse / categoryUnderstood? / stMentioned / stBindingStrength(none|weak|strong)/ stBindingDetail? / voidSize(critical→none 五档)/ voidSeverity(1-10)/ dominantCompetitors[] / primaryFailure(九类枚举)/ anchorStatus? / groundingUrls?`

**MultiModelVerificationResult**:`snapshots[4](modelId/modelName/rawResponse/keyEntities/sentiment/latencyMs/error?)/ consensusLevel / consensusSummary / verifiedAt`

**IntentGroupDiagnosis**:`intentGroupId / label / questionIds / probeIds / metrics(questionCount/stMentionRate/avgVoidSeverity/criticalVoidCount/dominantCompetitors/primaryFailure)/ narrative / failureDiagnosis? / recommendedPlaybookIds?`

**CampaignSynthesis**:`synthesizedAt / brief: CampaignBriefDraft(objectives/audience/offer/market/geoKpis/timeline/channelMixSuggestion/budgetTier)/ intentDiagnoses[] / playbooks[] / executiveSummary / innovationPlays[]`(代码里还写入 `degraded` 标志,类型定义暂缺该字段)

**CampaignPlaybook** = hub 的 `StrategicPlaybookItem`(sourceLogic/tacticsType/contentPlatform/structuredDataStrategy/geoAction/targetSnippet/anchorIds)+ `id / intentGroupIds / targetQuestionIds / funnelStage? / effortTier?(S|M|L)/ channelMix?(owned/paid/earned/shared)`

**进度模型**:`ProbeDelta`(逐题:绑定/真空/严重度/锚点/失败类/竞品/共识的 前→后)、`IntentGroupDelta`(组级:ST 率差/严重度差/改善题数)、`CampaignProgressSnapshot`(phase/daysSinceBaseline/两组 delta/narrative)。

### 3.2 继承类型(types.ts,hub 时代)

`GeoFailureCategory` 九类失败分类学(注释标注改编自 AgentGEO 14 类体系)、`StrategicPlaybookItem`、`MonitoringQuestion`、`IntentCluster`、`CompetitorInsight`(威胁分级 Low→Critical)、`RoleSpecificSop`、`EvidenceQuality`/`ScoredEvidenceSource`(RAG 证据评分)、`AnchorVerificationResult`、`ModelVerificationResult` 等。campaign 类型从这里复用 failure 分类学、playbook 基型、锚点状态。

### 3.3 关系图

```
Campaign 1 ─┬─ 1 preprocess ── n SeedQuestion ── n:1 IntentGroup
            ├─ n QuestionProbe(questionId → SeedQuestion;phase 区分基线/复测)
            │      └─ 0..1 MultiModelVerificationResult(4 snapshots)
            ├─ 0..1 CampaignSynthesis ─┬─ n IntentGroupDiagnosis(intentGroupId →)
            │                          └─ n CampaignPlaybook(targetQuestionIds →)
            └─ n CampaignProgressSnapshot(fromProbeId/toProbeId →)
```

所有关联靠字符串 id 软引用,无 schema 校验层(除 LLM 响应的 responseSchema)。

---

## 4. LLM 调用清单

### 4.1 调用点(共 7 处业务调用)

| # | 调用 | 文件:函数 | 模型槽位 | 实际模型 | 输出约束 |
|---|---|---|---|---|---|
| 1 | 种子问题预处理 | campaignGeminiService:`preprocessSeedQuestions` | `analysis` | gemini-2.5-pro | responseSchema(JSON) |
| 2 | 逐题认知探测 | campaignGeminiService:`runGeminiQuestionProbe` | `grounding` | gemini-2.5-flash | responseSchema + 代码层归一化 |
| 3 | Campaign 综合 | campaignGeminiService:`synthesizeCampaign` | `analysis` | gemini-2.5-pro | responseSchema + 失败修复重试 + degraded 降级 |
| 4 | JSON 修复(3 的子流程) | 同上 | `analysis` | gemini-2.5-pro | responseSchema |
| 5 | 报告生成(流式) | geminiService:`generateCampaignReportStream` | `contentGen` | gemini-2.5-flash | 无 schema,`%%MD_START%%`/`%%HTML_BODY_START%%` 哨兵分隔 |
| 6 | 进展叙事 | geminiService:`generateProgressNarrative` | `contentGen` | gemini-2.5-flash | 自由文本 |
| 7 | 聊天助手 | geminiService:`chatWithAssistant` | `chat` | gemini-2.5-flash | 自由文本 |
| 8 | CN 四模型探测 | multiModelService → server `/api/multi-model-probe` | — | deepseek-chat / qwen-plus / doubao-pro-32k(可经 key 内 `\|endpointId` 覆写)/ moonshot-v1-8k | 自由文本,max_tokens 512, temperature 0.3 |

### 4.2 Prompt 存放方式

- **全部硬编码在 TypeScript 源码里**,以模板字符串内联于各 service 函数;无 prompt 文件、无版本化、无外部配置。
- 最大的一个是报告 prompt(`buildCampaignReportPrompt`,~110 行模板),内嵌:元数据钉死规则(档案号/日期/模型名由代码计算后注入,禁止 LLM 编造)、四模型章节三分支 directive(有真实数据/跑了全失败/没跑)、degraded 警示、10 章节强制结构、逐章深度规则。
- 探测 prompt 内嵌打分一致性铁律(如 stMentioned=false ⇒ severity≥6);预处理 prompt 内嵌"保留用户问题原文"约束。
- Gemini 模型名集中在 `config/models.ts`(5 个用途槽位);CN 模型名硬编码在 `server.js` 的 MODEL_CONFIGS(Doubao 的 endpoint 可通过 key 值携带覆写)。

---

## 5. 诊断能力现状

### 5.1 多模型诊断执行方式

- **两轨并行**:① Gemini **模拟**探测(所有生态必跑)——角色扮演式,自带打分;② CN 四模型**真实**探测(仅 ecosystem=cn 或 region 命中中国时跑)——真实 API 响应,由代码做实体抽取/情感/共识分析。
- 执行为**串行逐题**(for 循环,一题完成再下一题);单题内四个 CN 模型并行(Promise.all)。
- 每次探测每题**只跑 1 次**,无多次取共性;温度未在 Gemini 探测中显式设置(CN 模型固定 0.3)。
- 探测失败的 CN 模型返回带 `error` 的空快照,不中断流程;共识分析只统计成功≥2 的模型。
- 无 run-level 元数据记录(日期在 probe 上,但无"本次 run 用了什么模型集/几次/异常"的独立记录)。

### 5.2 结果存储

- 全部挂在 `Campaign.probes[]` 数组里进 localStorage;每条 probe 自带 `probedAt`、`phase`、完整 Gemini 快照与可选四模型快照。
- 报告是即时生成的字符串,预览后可下载 MD/HTML,**不持久化报告内容本身**(只记 `reportGeneratedAt`)。

### 5.3 基线与历史对比

- **有基线概念**:第一轮探测 phase=`baseline`(T0);题文冻结在 probe 上(`questionText` 冗余快照,类型注释明确为可复现复测设计)。
- **有复测**:Blueprint 页"重新探测"按钮,用原题重跑(当前写死 phase=`mid`;类型支持 mid/end/ad_hoc)。
- **有确定性 delta**:逐题(绑定/真空/严重度/失败类/竞品/共识 前→后)+ 意图组级(ST 率差/严重度差/改善题数),纯代码计算;叙事由 LLM 写。
- 历史以 `progressSnapshots[]` 追加保存;UI 只展示最新一条快照的叙事;报告生成时可带最新快照作 Progress 附录。

---

## 6. 外部依赖

| 依赖 | 用途 | 调用方式 |
|---|---|---|
| Google Gemini API(gemini-2.5-pro / 2.5-flash) | 全部分析/生成 | 服务端 `@google/genai` SDK,浏览器经 `/api/gemini/*` 代理 |
| DeepSeek API(api.deepseek.com) | 真实探测 | 服务端 REST(OpenAI-compatible) |
| 阿里百炼 Qwen(dashscope.aliyuncs.com) | 真实探测 | 同上 |
| 火山引擎豆包(ark.cn-beijing.volces.com) | 真实探测 | 同上 |
| Moonshot Kimi(api.moonshot.cn) | 真实探测 | 同上 |
| Jina Reader(r.jina.ai) | 抓取用户提供的参考 URL 转正文,供 synthesis 做上下文(每 campaign 最多 3 条、每条截 3000 字符) | 服务端 GET 代理,带私网黑名单 |
| GCP Secret Manager | 5 个 API key 运行时拉取 | 服务端启动时,ADC 缺失则退回 process.env |

**联网搜索能力:当前生产代码没有。**
- Gemini 调用均未挂 `googleSearch` tool(仓库根目录的 test-search.ts/test-search2.ts 是验证"search grounding + JSON schema 能否共存"的手工实验脚本,未接入 app)。
- 类型层预留了 `groundingUrls`、`ModelVerificationResult`(Google Search 验证)、`AnchorVerificationResult` 等字段,均无生产调用方填充。
- 探测所得"竞品/市场认知"完全来自各 LLM 的训练数据 + 角色扮演,无实时检索佐证。

---

## 附:与 MASTER SPEC 术语的初步映射(仅登记名词对应,不做完整度评判——留给下一 Phase)

| Spec 概念 | Repo 中最接近的现有物 |
|---|---|
| S2 基准问题集(冻结) | SeedQuestion(text 冻结 + tier + intentGroup) |
| S3 诊断执行 | campaignPipeline 探测阶段(Gemini 模拟 + CN 四模型) |
| S3 run-meta | 无独立工件;信息散在 probe 字段 |
| S4 判读/作战卡 | CampaignSynthesis(intentDiagnoses + playbooks) |
| S5 计划(内部版/对外版) | CampaignBriefDraft + 报告(单版本) |
| S8 复测 + delta | rerunCampaignProbes + probeDelta + progressSnapshots |
| 工件(YAML front matter .md) | 无;数据全为 localStorage 里的 JSON 对象 |
| S0/S1/S1.5/S7/S9、evidence-registry、decision-log、Orchestrator | 未发现对应实现 |
