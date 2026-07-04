# GAP-ANALYSIS — repo 实现 vs Master Spec v1.1(Phase 1)

> 标尺:`docs/campaign-pipeline-master-spec.md`(冲突时默认 repo 需要改,不是 Spec 有问题)。
> 快照:branch `claude/campaign-pipeline-spec-gfvqqa` @ `1cfaf03`。现状事实见 `CURRENT-STATE.md`,本文只做判断。
> 判定口径:**[已实现]** = 该阶段的核心契约成立且有机制保障;**[部分实现]** = 有可辨认的对应物但契约不完整或无保障;**[缺失]** = 无对应实现(类型占位、注释意图不算实现)。

---

## 总览

| 阶段 | 判定 | 一句话 |
|---|---|---|
| S0 盘点 | **[缺失]** | 只有一个输入表单,四个 S0 工件一个都没有 |
| S1 Persona/VP | **[缺失]** | synthesis 副产品里有 audience 字段,但无假设标记、无独立工件、无回填 |
| S1.5 Message Map | **[缺失]** | 无主张/证据/禁用表述结构;报告 prompt 里的措辞规则是另一回事 |
| S2 问题集设计 | **[部分实现]** | 问题结构(tier/意图组/优先级)最接近 Spec;但冻结无机制、构成规则无校验、无版本 |
| S3 诊断执行 | **[部分实现]** | CN 四模型真实探测是真的;但违反零提示铁律、单次无共性、无 run-meta、双轨混流 |
| S4 判读 | **[部分实现]** | 有意图诊断+失败归因+确定性指标;但无 battle-map 分档、无过门、无回填、与 S5 混在一次调用里 |
| S5 计划 | **[部分实现]** | 有 brief/时间线/playbook/渠道建议;但无双版本、无生产分级(A/B/C)、无派生 channel-matrix、无三角布链 |
| S6 内容生产 | **[缺失]** | playbook 描述"该做什么内容",但系统不生产内容;报告≠内容 |
| S7 前置检查+分发 | **[缺失]** | 无 checklist、无 publish-log、无承接度门、无付费跟随逻辑 |
| S8 复测+行动决策 | **[部分实现]** | 冻结题复测+确定性 delta 是全 repo 最贴近 Spec 的部分;但无行动默认裁决表、无过门、无双流互证 |
| S9 复盘进化 | **[缺失]** | 无 retrospective、无 decision-log 可分析(因为没有 decision-log) |

全局协议:2.1 工件即契约 **[缺失]**|2.2 阈值与决策门 **[部分实现,且方向做歪]**|2.3 Orchestrator 权限 **[缺失,且现有行为与条款相反]**|2.4 证据纪律 **[部分实现(仅报告层)]**|2.5 双颗粒度 **[缺失]**。

---

## 逐阶段判定与证据

### S0 · 盘点 — [缺失]

Spec 要求四个工件:charter(含页面承接度 Tier A–D)、evidence-registry.csv、gap-list、operating-rhythm。

- Repo 的"盘点"只有 `CampaignCreateInput`(`src/types/campaign.ts:61-69`):topic + 可选种子问题 + 可选 URL + 时长。对应 UI 是 `StepCampaignDiscovery.tsx:147-203` 的一个表单。
- charter 的必填字段(主题线成熟度、产品方案锚、目标页面清单+上线状态、资源盘点、成功定义、合规红线)一个都不存在。
- **页面承接度**:系统里根本没有"页面"这个实体。`sourceUrls` 只是 RAG 上下文素材(`campaignPipeline.ts:45-55`,抓 3 条各截 3000 字符喂给 synthesis),不是被评估、被分档、被导流的目标页面。
- evidence-registry / gap-list / operating-rhythm:零对应物(全库 grep 无 claim、registry、gap-list 概念)。

### S1 · Persona & VP — [缺失]

- 最接近的是 synthesis 输出里的 `brief.audience`(`types/campaign.ts:186-191`:primary/secondary/geographies/funnelFocus 四个字符串数组),由 S5 等价阶段的 LLM 一次性生成(`campaignGeminiService.ts:445`)。
- Spec 的核心是:S1 先出**带 `[假设]` 标记**的独立工件,S4 后**显式回填**(证实/推翻/修正)。repo 里 audience 是诊断之后才生成的副产品,顺序反了,且无假设标记、无验证点、无回填路径。
- Persona 卡的六个维度(角色/关心/不关心/渠道/决策影响/匹配形式)无对应结构;VP(主/子)无对应结构。

### S1.5 · Message Map — [缺失]

- 无"主张/支撑理由/证据类型(claim_id)/禁用表述/适合渠道"五栏结构的任何对应物。
- 最接近的东西是报告 prompt 里的措辞规则(`geminiService.ts:403`"Avoid fluff adjectives")——但那是**报告文风指令**,不是可被 S2/S5/S6 统一消费的话术骨架,且三类禁用表述(brand/evidence-risk/channel-risk)的区分完全不存在。
- `CampaignPlaybook.targetSnippet`(想让 AI 答案框收录的"黄金片段")有一点主张的影子,但它挂在战术上而非独立话术层,也不链接任何证据。

### S2 · 基准问题集设计 — [部分实现]

**已有(证据)**:
- 问题结构与 Spec 高度同构:`SeedQuestion`(`types/campaign.ts:73-84`)有冻结原文、tier(category/sub_node 对应 Spec 品类层/子节点层)、intentGroupId、P0-P2 优先级、expectedAnchor。
- 无问题时 AI 生成 6–8 个、有问题时保留原文(`campaignGeminiService.ts:267-278`,prompt 明确 "Keep each user question text EXACTLY as given")。

**缺/歪**:
- **构成规则零校验**:Spec 要求"无死指标、主战场≥2 题、每条主张至少 1 题、一半以上有真实提问证据"。代码对 LLM 产出的问题集只查非空(`campaignGeminiService.ts:298-300`),四条规则一条都不校验;"真实提问证据"(知乎问题/搜索词/FAE 反馈)无输入通道。
- **中英双语双轨**:无。问题只有单一 `uiLang`,无两语不混轨概念。
- **"定稿即 frozen,换题=新版本+重建基线"**:无版本号、无重建基线流程(详见契约 B)。

### S3 · 诊断执行 — [部分实现]

**已有(证据)**:
- CN 生态下对 DeepSeek/Qwen/Doubao/Kimi 的**真实**并行探测(`multiModelService.ts:212-233`,`server.js:207-268`),失败不虚构(error 快照,`multiModelService.ts:97-101`)。
- 固定模型集(4 个,服务端硬编码);报告层严格区分"真实探测/跑了全失败/没跑"三态(`geminiService.ts:280-295`)。

**缺/歪(对照《Eval-Protocol》Part A 铁律)**:
- **违反零提示铁律(做歪了,严重)**:CN 探测 prompt 注入了 campaign 主题并**指示模型点名厂商**——`multiModelService.ts:203-208`:`Campaign context: ${campaignTopic}… Mention specific semiconductor vendors, product families, and part numbers`。这是引导性探测,测出来的不是自然认知。Gemini 探测更甚:把 `expectedAnchor`(期望 ST 出现的实体)直接写进模拟 prompt(`campaignGeminiService.ts:375`"EXPECTED ST ANCHOR"),等于提前告诉被测者答案里该有谁。
- **多次取共性**:每题每轮只跑 1 次(`campaignPipeline.ts:74-112` 单层 for 循环),无跨次频率,直接导致 S4 的"稳定/波动区分"和威胁分级失去数据基础。
- **心智占位与内容货架分轨**:无此区分。
- **run-meta 工件**:无。日期散在 probe 上,"用了什么模型集/几次/异常"没有独立记录(CN 模型名倒是在快照里)。
- **双轨混流风险**:主探测轨(所有生态必跑)是 Gemini **角色扮演模拟**而非真实认知(`campaignGeminiService.ts:369` "Role-play as a generative AI assistant"),真实探测只在 CN 生态触发(`campaignPipeline.ts:71-72`)。global/jp/kr 生态的"诊断"完全是模拟。报告层把两轨的置信级分开了,但**数据层**(voidSeverity、竞品、失败归因这些驱动全部下游决策的数字)只来自模拟轨——四模型真实响应仅贡献 consensusLevel,不参与打分。

### S4 · 判读 → 作战洞见 — [部分实现]

**已有(证据)**:
- 意图组诊断:metrics + narrative + failureDiagnosis(九类失败分类学,`types.ts:101-110`)+ 推荐 playbook 关联(`types/campaign.ts:159-174`)。
- 指标不信 LLM、代码确定性重算(`intentMetrics.ts:69-94`)——这符合 Spec"阈值给默认"的精神。
- 报告有竞品诊断矩阵章节,竞品提及计数由代码算好喂给 LLM(`geminiService.ts:223-241`)。

**缺/歪**:
- **认知形状(稳定/波动)**:不可能实现,因为 S3 单次探测(见上)。
- **竞品威胁分级**:Spec 要求按**跨次出现频率**给默认裁决(稳定压制/可争夺/偶发/噪音)再过门。repo 是按**跨题**提及次数计数(`geminiService.ts:223-231`)、报告里让 LLM 自己标威胁档(`ReportModal.tsx:26` 只是渲染 LLM 写的 [高威胁] 标签)——分级是 LLM 叙事,不是阈值默认裁决,更没有 owner 过门。
- **页面心智分档(主战场/攻坚/守位/挂钩)**:无页面实体,无分档。
- **回填 S1/S1.5**:无(S1/S1.5 本身不存在)。
- **next-question-backlog**:无。intent 矩阵覆盖缺口无追踪。
- **与 S5 混流(做歪了)**:判读(intentDiagnoses)和计划(brief/playbooks)在**同一次 LLM 调用**里产出(`campaignGeminiService.ts:444-454` 一个 prompt 同时要诊断和计划)。Spec 把 S4/S5 设计成两个引擎、两个工件、中间隔着决策门;repo 里没有任何机会在"判读完"和"开始计划"之间插入人的确认。

### S5 · 计划与时间线 — [部分实现]

**已有(证据)**:
- brief 含 objectives/audience/offer/market/geoKpis/timeline/channelMixSuggestion/budgetTier(`types/campaign.ts:179-213`);playbook 含 funnelStage/effortTier/channelMix 四渠道占比(`types/campaign.ts:225-232`);报告有 T0→T30→T60→T90 时间线章节(`geminiService.ts:380-381`)。
- KPI 有一条纪律与 Spec 同向:geoKpis 强制 GEO-only、以探测基线为起点、禁 web 流量/线索数(`campaignGeminiService.ts:451-452`)——接近"KPI 只准引用监测方向"的条款。

**缺/歪**:
- **生产分级默认裁决(A 人工主笔/B AI 初稿人深改/C AI 产人审)**:无。`effortTier: S/M/L`(`types/campaign.ts:56`)是工作量档,不是人机分工档——语义不同,不能充当。
- **双版本(internal 细 / share 对外无数字承诺)**:只有一份报告,无对外版,无"无数字承诺"边界控制。
- **channel-matrix 派生视图**:无。`channelMix` 数字是 LLM 直接生成的(违反"派生视图由 Orchestrator 从作战卡汇总、不许手工/LLM 直接成为策略源"的协议方向)。
- **证据链三角布链(目标页↔长文↔问答互链)**:无。
- **火力比例过门**:无门(playbook 勾选见契约 D,但那不是火力比例裁决)。

### S6 · 内容生产 — [缺失]

- Spec 的 S6 是"作战卡即工单 → 产出成稿 + 引用证据映射(claim_id)+ 六问自检 + 待填清单回写 gap-list"。
- repo 的 playbook 只描述**该做什么**(geoAction/contentPlatform/targetSnippet),没有任何把 playbook 变成稿件的功能。报告生成(`generateCampaignReportStream`)产出的是**campaign 报告**,不是对外内容——两者不能混同。
- 引用证据映射、六问自检、三类禁用表述检查、gap-list 回写:全部无对应物(依赖的 registry/message-map/gap-list 本身不存在)。

### S7 · 前置检查 + 分发 — [缺失]

- launch-checklist(逐项勾选全过才发车):无。
- publish-log(每篇 URL/日期/渠道/所属作战卡,复测归因用):无——这直接掏空了 S8 的归因能力(复测发现变化时无法对到"我们发了什么")。
- 前置门三条(页面上线+承接度达标 / 归因配置 / 合规过审):无页面实体、无归因配置、无合规流。
- 付费跟随内容逻辑(未索引不投、先守后攻):无。

### S8 · 复测 + 行动决策 — [部分实现](全 repo 最接近 Spec 的部分)

**已有(证据)**:
- 用原题重跑(`campaignPipeline.ts:188-195` 复用 `campaign.preprocess.questions`)→ 与 baseline 逐题对比(`probeDelta.ts:64-101`,baseline 按 phase 过滤、按 questionId 配对)→ 确定性 delta(绑定/真空/严重度/失败类/竞品/共识,`probeDelta.ts:14-34`)→ 意图组级 delta + 改善题数(`probeDelta.ts:36-62`)→ LLM 只写叙事(`geminiService.ts:423-441`)。"冻结基线复测、代码算账、LLM 说话"这个骨架是对的。

**缺/歪**:
- **行动默认裁决表**:Spec 的五行裁决(真空被我们填/被竞品填/2 期无变化/3 期无变化/已赢滑落)无任何对应实现;delta 算完直接展示,不产生建议动作,更无 owner 过门后执行。
- **真空追踪(intent vacuum)**:无独立追踪;"连续 N 期"逻辑不存在(虽然 progressSnapshots 数组保留了历史,数据上可算)。
- **双流互证(probe × AI referral 流量)**:无任何页面侧行为数据接入。
- phase 写死 `'mid'`(`StepCampaignBlueprint.tsx:91`,三元表达式两支都是 'mid'),end/ad_hoc 类型有值无路径。
- **基线可被整体摧毁**:见契约 B——这是 S8 命脉上的洞。

### S9 · 复盘进化 — [缺失]

- retrospective 无;"分析被推翻的默认裁决、校准阈值"无从谈起(无 decision-log);工件归档案例库无(单 campaign 覆盖式存储,连历史 campaign 都留不住)。

---

## 六个核心契约重点检查

### A. 工件契约 — [缺失]

- **没有统一工件对象模型**。全系统只有一个 `Campaign` JSON 聚合塞进 localStorage(`workflowStore.ts:154-177`),各层数据是它的嵌套字段,不是各自带元数据的工件。
- 对照 Spec §0 的统一 front matter 逐字段核对:`campaign_id` 有(`camp-<timestamp>`,非 Spec 的 CAM-YYYY-NNN 编号体系);`status` 有但语义不同——`CampaignStatus`(`types/campaign.ts:32-39`)是**流水线进度**(draft→probing→ready→active),不是**治理状态**(draft/approved/frozen/deprecated),没有 approved 和 frozen;`version` 无;`owner/approval_by/approval_date/source_of_truth/business_line` 全无。
- 唯一带版本号的是 localStorage 的 schema 版本(`STORAGE_VERSION = 3`,`workflowStore.ts:9`)——那是存储迁移版本,不是工件版本。
- 结论:各功能共用一个 blob,**没有契约**;"必填字段缺失=拒绝执行"的契约校验逻辑无处安放(现有校验只有 preprocess 非空检查一处,`campaignGeminiService.ts:298-300`)。

### B. 状态与冻结(命脉)— [部分实现:意图在、机制无、且有一条会摧毁基线的路径]

**能对比基线,这部分是真的**:题文冻结在 probe 快照上(`types/campaign.ts:129` questionText 冗余副本);复测复用原题(`campaignPipeline.ts:193`);delta 严格 baseline vs latest 配对(`probeDelta.ts:71-86`)。

**但"冻结"没有任何机制保障,三条证据**:

1. **frozen 只存在于注释**。全库唯一的 "frozen" 是 `types/campaign.ts:75` 的类型注释;没有状态位、没有写保护。设计上预留的"确认前可编辑问题"入口 `CampaignConfirmPayload.editableQuestions`(`types/campaign.ts:305-310`)是**死类型,无任何调用方**——当前题文事实上稳定,是因为**没做编辑功能**,不是因为**做了冻结**。这两者在"产品化后加个编辑按钮"的那一刻会分道扬镳。
2. **任意改写通道敞开**:`updateCampaign(patch)` 接受任意 Partial(`workflowStore.ts:130-134`),probes、preprocess、synthesis 都可被覆写,无 status 检查。
3. **重跑 Step 1 = 无声摧毁基线**:`StepCampaignDiscovery.handleRun` 每次生成**全新 campaign 并整体替换**(`StepCampaignDiscovery.tsx:105-117` → `setCampaign(result)`),旧 campaign 连同基线、复测历史全部丢失,无确认、无归档、无"换题=新版本+重建基线"的显式流程。用户在 Step 1 改一个字重跑,三个月的基线就没了。
4. 附带:单 campaign 存储意味着"冻结的基线"最多活到下一次有人跑新 campaign。

**判定**:复测-对比链路成立(这是 S8 得 [部分实现] 的原因),但 Spec 意义上的"冻结"(状态语义 + 防改动 + 改动必须升版本重走审批)为零机制。命脉契约当前靠"功能还没做全"这个巧合维持。

### C. 证据纪律 — [缺失](报告层有局部替代物,不构成登记表)

- **无证据登记表**:没有 claim_id、来源链接、来源等级、claim_scope、失效日期中的任何一个概念。
- 系统里所有量化数字的来源是**LLM 探测打分**(voidSeverity 等)和**LLM 生成的 KPI/渠道占比**(`campaignGeminiService.ts:445-452` 由 synthesis 一次生成)。这些数字直接进 brief、进报告,无登记、无追溯。
- **最接近证据纪律的两个局部机制**(值得肯定但不等价):① 报告元数据(档案号/日期/模型名)由代码计算、prompt 禁止 LLM 编造(`geminiService.ts:195-221`,300-306);② 反虚构铁律——"every claim must trace to provided probe/snapshot data, 数据缺失写待补充"(`geminiService.ts:369`)、四模型章节按真实数据状态三分支渲染(`geminiService.ts:280-295`)。这是"不虚构"纪律,不是"单一事实源"纪律:它约束报告这一个消费端,而 Spec 的 registry 是全流程(S0 入册→S1.5 链接→S6 取数→gap-list 回写)的**生产端**契约。
- 结论:数字可信度依赖 prompt 自律,散落各处、无法追溯来源,判 [缺失]。

### D. 人机决策门(区别于"自动生成工具"的关键)— [部分实现:有两个 UI 确认点,但没有一个构成 Spec 意义的决策门]

**现有的人工介入点(全部证据)**:

1. **Discovery 确认**:看完基线表点确认才能进 Step 2(`StepCampaignDiscovery.tsx:129-133` → `setDiscoveryConfirmed(true)`)。记录仅为一个布尔值(`workflowStore.ts:101,137`),无确认人/时间/确认了什么。
2. **Playbook 勾选**:默认选中非 L 档(`StepCampaignDiscovery.tsx:118-121`——这其实是一个"默认裁决"!),用户可增减(`togglePlaybookId`),选择结果过滤进报告(`geminiService.ts:192-194`)。这是全系统唯一一处"AI 给默认 → 人可改 → 结果生效"的完整闭环。
3. 报告生成、复测由人手动触发(按钮),算时机控制,不算裁决。

**对照 Spec §2.2 逐项缺**:
- "AI 建议 → 人确认/推翻 → **记录**"三段,第三段完全缺失:playbook 勾选只存最终选中集(`selectedPlaybookIds`),**不记录默认是什么、推翻了什么、为什么**——S9 要用来校准阈值的数据根本没被采集。
- `decision-log.md` 无对应物。"没进 decision-log 的不算正式裁决"——按此标准 repo 里零正式裁决。
- Spec 列的七个必过门(persona/VP 取舍、页面分档、竞品口径、火力比例、对外措辞、发车放行、复测行动):除 playbook 勾选勉强沾边"火力"外,其余六个门在流程里**位置都不存在**——尤其 S4 判读和 S5 计划在同一次 LLM 调用里(见 S4 节),门想插都没有缝。
- **真正的默认裁决反而绕过了人**:`normalizeProbe`(`campaignGeminiService.ts:317-356`)是一套货真价实的阈值系统(severity 钳位、binding↔severity↔voidSize↔failure 互锁)——这正是 Spec 说的"阈值产出默认裁决"。但它的输出**直接生效**,无人确认、无推翻通道、无日志。Spec 的公式是"阈值给默认,门给生效";repo 是"阈值即生效"。

**判定**:交互上有"人在环"的形(两个确认点),治理上没有"人在环"的实(无记录、无推翻语义、关键裁决不过人)。按你的原话标准——"AI 输出直接进入下一步"在最关键的判读→计划环节是事实。

### E. 人机边界:诊断执行 vs 规划判读 — [部分实现:模块分离清晰,但两处语义混流]

**分离得好的部分**:
- 代码层三段清晰:诊断执行(`multiModelService.ts` 真实调用 + `server.js:207-268` 代理)/ 判读规划(`campaignGeminiService.ts` synthesis)/ 确定性计算(`intentMetrics.ts`、`probeDelta.ts` 不用 LLM)。
- 数据流转显式:probes[] → 结构化 probeSummary JSON → synthesis prompt(`campaignGeminiService.ts:420-427`);LLM 算的指标一律被代码重算覆盖(`campaignPipeline.ts:172-179`)。
- 报告层强制区分置信级:"Gemini simulation 和真实 CN 探测是不同置信档,禁止把 Gemini 自产输出标成跨模型证据"(`geminiService.ts:370`)。

**混流的两处(做歪了)**:
1. **执行与判读混在一次调用**:Gemini 探测让同一个模型在同一个 prompt 里既模拟回答又给自己打分(voidSeverity/failure 归因,`campaignGeminiService.ts:369-392`)。Spec 的 S3 是干净执行(零提示、只记录),S4 才判读。裁判和运动员是同一次 API 调用。
2. **主数据轨是模拟不是执行**:驱动全部下游(指标/brief/playbook/KPI)的打分只来自 Gemini 模拟轨;真实四模型响应只产出 consensusLevel 这一个旁路信号(`campaignGeminiService.ts:426`),不进打分。等于"诊断执行"的产出大部分没被消费,"判读"消费的大部分不是执行产出。

### F. Prompt 管理 — [缺失:全部硬编码]

- 8 个 LLM 调用点的 prompt 全部是 service 函数内的模板字符串(证据清单见 `CURRENT-STATE.md` §4);无 prompt 文件、无版本号、无运行时可编辑性。唯一的外部化是模型名槽位(`config/models.ts`)。
- Spec 的架构是"引擎文档挂载"——《Eval-Protocol v1.1》《Insight-Prompt》《Plan-Instruction v2》《Content-Generation-Prompt》作为独立、可升版的规范被 S3-S6 引用。repo 中这四份引擎文档**都不存在**,其职能被压缩成三个内联 prompt(探测/综合/报告),且综合 prompt 同时兼任 Insight-Prompt 和 Plan-Instruction 两个引擎的角色(S4/S5 混流的根源)。
- 后果:prompt 迭代不可追溯(只能靠 git diff 源码)、无法独立于代码发版、S9"新规则回写引擎并升版本"无落点。

---

## 附:按 Spec 视角的"做歪了"清单(与缺失分开列,因为它们是要改方向而不是补功能)

| # | 做歪点 | 位置 | Spec 依据 |
|---|---|---|---|
| 1 | 探测 prompt 注入 campaign 主题、指示点名厂商、注入 expectedAnchor——引导性探测 | `multiModelService.ts:203-208`;`campaignGeminiService.ts:375` | S3 零提示铁律 |
| 2 | S4 判读与 S5 计划合并为一次 LLM 调用,决策门无处插入 | `campaignGeminiService.ts:410-454` | S4/S5 分阶段 + §2.2 过门 |
| 3 | 阈值默认裁决(normalizeProbe)直接生效,无人确认无日志 | `campaignGeminiService.ts:317-356` | §2.2 "阈值给默认,门给生效" |
| 4 | 竞品威胁分级由 LLM 叙事产生,而非跨次频率阈值+过门 | `geminiService.ts:388-391`(prompt 要求 LLM 写威胁档) | S4 威胁分级默认裁决 |
| 5 | channelMix/KPI 数字由 LLM 直接生成为策略源,而非从作战卡派生 | `campaignGeminiService.ts:445-451` | S5 channel-matrix 派生视图条款 |
| 6 | 重跑 Step 1 无声替换整个 campaign,基线可被静默摧毁 | `StepCampaignDiscovery.tsx:105-117` | §0 frozen 语义 + S2 换题=新版本 |
| 7 | 流水线对 LLM 不合规输出的策略是"静默修复"(normalizeProbe 补值、JSON repair、degraded 兜底)而非"拒绝并打回" | `campaignGeminiService.ts:317-356, 477-502` | §2.3 总控不得将不合规工件顺手修成合规(注:对 LLM 原始输出做修复是合理工程,但当这些输出承担"工件"角色时,Spec 的方向是显式拒绝/标记,repo 目前只有 degraded 一个标记做到了) |
| 8 | effortTier(S/M/L 工作量)被放在生产分级(A/B/C 人机分工)的位置上 | `types/campaign.ts:56`;`StepCampaignDiscovery.tsx:118-121` 用它当默认选择依据 | S5 生产分级默认裁决 |

## 一段话结论

这个 repo 是一台**质量意识很强的单人诊断-简报生成器**:S2/S3/S8 的"冻结题—探测—确定性 delta"骨架、指标代码重算、报告反虚构纪律,都与 Spec 的精神同向,是可以长出完整系统的好底子。但 Spec 定义的**治理层几乎整体缺席**:没有工件(A)、没有真冻结(B)、没有证据登记(C)、没有决策门与日志(D)、判读与计划混流(E)、引擎不可版本化(F);S0/S1/S1.5/S6/S7/S9 六个阶段无实现。按 Spec 的一句话总纲衡量:"阈值给默认"做了一半(有阈值),"门给生效"和"日志给追溯"是零。当前它是方法论里"S2→S3→S4/S5(混)→S8"这一条線的自动化切片,而不是流水线。
