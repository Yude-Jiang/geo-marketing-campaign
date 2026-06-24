# geo-strategic-hub-experimental — Claude Code 修复任务清单（修订版）

> 本文件在原始清单基础上，结合对当前代码库的逐项核实做了**事实性修正**。
> 修订要点集中在 P0-3（SSRF 威胁模型）、P1-2（Europe 关键词"修复"逻辑）、
> P2-4（helmet import 位置）、P1-4（fetchUrlContent 归属）四处。
> 已被实现的部分在每个任务末尾标注 `✅ 已实现` / `🔵 部分实现` / `⏸ 暂缓`。

---

## 修订说明（相对原始清单的改动）

| 任务 | 原始清单问题 | 修订动作 |
|------|-------------|---------|
| **P0-3** | 声称攻击者可经 `/api/fetch-url` 读取本服务 GCP metadata token。实际 `server.js` 请求的是 `https://r.jina.ai/${url}`，出站方是 Jina 服务器而非本应用，link-local 元数据地址不可达——威胁被高估。黑名单还可被 DNS rebinding / 十进制 IP / 重定向绕过。 | 降级为**纵深防御**，明确"真实风险是经 Jina 转发的 SSRF 与对外滥用"，保留黑名单但注明其局限。 |
| **P1-2** | 误匹配示例 `revenue`/`queue`/`unique` 实际**不含子串 `'eu '`**；且"修复版"仍把 `'eu '` 放进 `includes()`，**没有真正修复**所声称的 bug。 | 改用 `\beu\b` 词边界正则真正修复；CJK 关键词单独用 `includes`（JS `\b` 对中文无效）；删除错误示例。 |
| **P2-4** | `import helmet from 'helmet'` 被要求写在 `startServer()` 函数体内——ESM `import` 必须顶层，否则 SyntaxError。 | 顶层 `import`，函数内 `app.use(helmet(...))`。 |
| **P1-4** | 重导出块从 `./contentService` 导出 `fetchUrlContent`，但"注意"又说应留在 `geminiService`——自相矛盾。 | 统一：`fetchUrlContent` 留在 `geminiService.ts`（依赖 server 代理，非 Gemini API），不从 contentService 导出。 |
| **P1-3** | 假设 StandaloneMode 有深度搜索逻辑。实际 `handleOptimize` **没有** `deepEvidenceGrounding` 调用。 | 标注为：仅随 P1-1 统一类型获得 `isDeepSearching` 字段，**不**新增伪 UI；无功能改动。 |
| **P0-1** | 新模型名 `gemini-3.1-flash-lite` 为假设值，无法离线核实。 | 保留改动，但明确这是**待线上验证**的假设，不是既成事实。 |

---

## P0 — 必须立即修复

### P0-1：修复 Gemini 模型名称  ✅ 已实现
**文件**：`src/config/models.ts`
将 `analysis` 与 `contentGen` 的 `gemini-3.1-flash-lite-preview` 改为 `gemini-3.1-flash-lite`。
> ⚠️ **注意**：`gemini-3.1-flash-lite` 是"去掉 -preview"的推断 GA 名，**必须线上 curl/AI Studio 验证**后才能确认。若 404，回退到 `gemini-2.5-flash`（已知可用）。

### P0-2：CN 模型调用移至服务端代理  ✅ 已实现
- `server.js` 新增 `POST /api/multi-model-probe`（服务端持有 DeepSeek/Qwen/Doubao/Kimi key，15s AbortController 超时）。
- `/config.js` 只注入 `VITE_GEMINI_API_KEY`，其余 4 个 CN key 不再下发浏览器。
- `multiModelService.ts` 删除 `callOpenAICompatible` 与所有 `*_BASE` 常量、四个 `query*` 函数，改为统一 `callViaProxy` + `queryModel`（含客户端 20s 超时，见 P2-1）。
- `index.html` 无需改动（它本就不直接引用 key）。

### P0-3：`/api/fetch-url` 加私网/元数据黑名单（纵深防御）  ✅ 已实现
**修订后的定性**：当前 `server.js` 实际抓取的是 `https://r.jina.ai/${url}`，因此"攻击者借此读取本服务 GCP metadata token"**不成立**——发起方是 Jina 的服务器，link-local 地址对它不可达。真实价值在于：
1. 阻止把内网/元数据地址转交给 Jina 抓取（避免成为 SSRF 跳板 / 对外滥用）；
2. 作为纵深防御，若未来该端点改为**直接** fetch，黑名单可兜底。

**已知局限（务必知晓，不要把它当成完整 SSRF 防护）**：
- 纯字符串黑名单**无法**防 DNS rebinding（域名解析到 `169.254.169.254`）、十进制/十六进制/八进制 IP 编码（如 `http://2852039166/`）、以及 302 重定向到内网。
- 完整方案需：解析 DNS → 校验解析出的 IP → 用固定 IP 发起请求并禁用重定向。本次仅做轻量兜底。

---

## P1 — 近期处理

### P1-1：提取 BundleOutput 公共逻辑  ✅ 已实现
新建 `src/services/outputParser.ts`，导出 `BundleOutput`/`emptyOutput`/`parseModelOutput`/`MAX_STREAM_CHARS`。
`StepProduction.tsx`、`StandaloneMode.tsx` 删除各自重复定义并改为 import。
> 行为变更提示：统一后的 `parseModelOutput` 含 STEP_PLAN 抽取逻辑，StandaloneMode 因此**新获得**该能力（属增强，无破坏）。StandaloneMode 的 `BundleOutput` 原缺 `isDeepSearching`，统一后自动补齐。

### P1-2：修复 Europe 区域误匹配 + 消除重复常量  ✅ 已实现
新建 `src/utils/regionUtils.ts`，**真正**用 `\beu\b` 等词边界正则修复 `'eu'` 误匹配；CJK 关键词（欧洲/欧盟）单独 `includes`。
`geminiService.ts`、`promptBuilder.ts` 删除各自的 `EUROPE_KEYWORDS`/`EUROPE_KW` 与本地 `isEuropeRegion`，改为 import。
> 原始清单的误匹配示例（revenue/queue/unique）经验证并不含子串 `'eu '`，已删除；真正的风险是 `'eu '` 这类 `includes` 子串匹配在某些输入下误命中，现用词边界根治。

### P1-3：StandaloneMode 深度搜索 UI  ⏸ 不适用（无功能改动）
经核实，`StandaloneMode.handleOptimize` **没有** `deepEvidenceGrounding` 调用，不存在"深度搜索阶段"。因此本任务退化为：随 P1-1 统一类型获得 `isDeepSearching: false` 字段即可，**不**添加永不触发的伪 UI。若将来为 StandaloneMode 引入深搜，再补 UI。

### P1-4：拆分 geminiService.ts（1153 行）  ⏸ 暂缓（独立 sprint）
体量大、风险高，按原始清单建议安排为独立 sprint。
> 修订：若执行，`fetchUrlContent` **保留在 `geminiService.ts`**（它依赖 server 代理而非 Gemini API），重导出块**不要**从 `contentService` 导出它。

### P1-5：补全 groundingMetadata 类型  🔵 部分实现
新建 `src/types/gemini.d.ts`。优先转换最常用的两条路径（`analyzeContent`、`deepEvidenceGrounding`）的 `(gResult as any).groundingMetadata` 为类型断言；其余 `generateContentStream` 等路径可后续逐步推进。

---

## P2 — 优化建议

- **P2-1**：`callViaProxy` 客户端 20s 超时  ✅ 已实现（并入 P0-2）。
- **P2-2**：Zustand `partialize` 大小保护（截断 persistedSources、只留最近 20 条 chatHistory）  ✅ 已实现。
- **P2-3**：流式截断在段落边界（`\n\n`）而非任意位置  ✅ 已实现（两个组件）。
- **P2-4**：server.js 加 helmet 安全头  ✅ 已实现（**顶层 import**，函数内 `app.use`）。
- **P2-5**：Vite 生产构建移除 console（terser `drop_console`）  ✅ 已实现。

---

## 验证清单
- [ ] `config/models.ts` 不再出现 `preview`；线上确认 `gemini-3.1-flash-lite` 可响应（否则回退 2.5-flash）。
- [ ] `/config.js` 仅含 `VITE_GEMINI_API_KEY`。
- [ ] 多模型验证时 Network 只见 `/api/multi-model-probe`，无 deepseek/dashscope/volces/moonshot 直连。
- [ ] `/api/fetch-url?url=http://169.254.169.254/...` 返回 403（注意：这是纵深防御，非完整 SSRF 防护）。
- [ ] `npm run build` 通过（terser 已安装）；`tsc -b` 无类型错误。
- [ ] 端到端：seed → 诊断 → 步骤2 → 步骤3 内容生成正常。
