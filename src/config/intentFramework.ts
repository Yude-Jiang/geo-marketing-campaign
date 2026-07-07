/**
 * Intent framework registry + resolvers + the built-in semiconductor seed.
 *
 * This file is CONFIGURABLE DATA. To support a new industry, add a new
 * IntentFrameworkDefinition here and register it — do NOT branch on dimension /
 * root-cause names anywhere in the codebase (hard-constraint #1).
 *
 * Versioning (hard-constraint #2): the registry is keyed by `${id}@${version}`
 * and OLD VERSIONS ARE NEVER DELETED. A campaign freezes against one exact
 * version; re-probes always resolve that frozen version so framework evolution
 * can never silently shift a historical campaign's alignment baseline.
 */

import type {
  EngineeringDimension,
  IntentFrameworkDefinition,
  RootCauseType,
} from '../types/framework';
import type { IntentGroup, SeedQuestion } from '../types/campaign';

/**
 * Sentinel dimension for questions with a missing / invalid dimensionId.
 * We SURFACE these (never silently drop) — Q4: sentinel + report.
 * Not a real framework dimension; it is a structural bucket, not a semantic branch.
 */
export const UNASSIGNED_DIMENSION_ID = '__unassigned__';
export const UNASSIGNED_DIMENSION_LABEL = '未归类（需重建基线）';

// ─── Seed: semiconductor B2B framework v1.0.0 ────────────────────────────────

const SEMI_DIMENSIONS: EngineeringDimension[] = [
  {
    id: 'cost-performance',
    label: '成本与性能权衡',
    description: '单价 / BOM 成本与算力、主频、能效之间的取舍;工程师"要不要为性能多付成本"的纠结。',
  },
  {
    id: 'reliability-safety',
    label: '可靠性与功能安全',
    description: '车规 / 工规等级、功能安全认证(ASIL/SIL)、失效率、宽温与长期可靠性。',
  },
  {
    id: 'migration-compat',
    label: '迁移与兼容',
    description: '从既有架构 / 竞品 / 上一代迁移的成本;引脚兼容、指令集兼容、软件可移植性。',
  },
  {
    id: 'integration-simplification',
    label: '集成度与系统简化',
    description: '片上集成(NPU / 无线 / 模拟)带来的 BOM 精简、板级面积、系统复杂度下降。',
  },
  {
    id: 'ecosystem-devexp',
    label: '生态与开发体验',
    description: '工具链、SDK、参考设计、社区与文档质量;上手速度与调试体验。',
  },
  {
    id: 'environmental',
    label: '环境与物理适应',
    description: '温度 / 湿度 / 振动 / EMC 等物理环境适应;封装与散热约束。',
  },
  {
    id: 'compliance-standards',
    label: '合规与标准',
    description: '行业标准符合性、法规准入、认证与出口合规红线。',
  },
];

// Root-cause ids intentionally mirror GeoFailureCategory literals (src/types.ts)
// so the existing per-probe `primaryFailure` field needs zero structural change.
const SEMI_ROOT_CAUSES: RootCauseType[] = [
  {
    id: 'CORPUS_ABSENCE',
    label: '语料缺失',
    description: 'AI 训练语料里几乎没有该产品 / 特性的信号。',
    repairAction: { summary: '建设权威语料:官方文档、结构化规格页、可被抓取的技术长文。', actsOn: 'this-question' },
  },
  {
    id: 'ATTRIBUTE_MISMATCH',
    label: '属性错配',
    description: 'AI 认得产品但引用了错误的价格 / 规格 / 定位。',
    repairAction: { summary: '发布权威更正内容,以结构化数据钉正确属性。', actsOn: 'this-question' },
  },
  {
    id: 'BURIED_ANSWER',
    label: '答案被埋',
    description: '答案在 PDF / datasheet 里,AI 爬不到。',
    repairAction: { summary: '把关键结论从 PDF 提到可抓取的 HTML,BLUF 前置。', actsOn: 'this-question' },
  },
  {
    id: 'COMPETITOR_DOMINANCE',
    label: '竞品压制',
    description: '竞品语料密度远超我方,AI 默认推荐竞品。',
    // Special: acts on a NEW question (change angle / semantic derivation).
    // Derivation flow NOT implemented this knife — definition only.
    repairAction: { summary: '换角度 / 语义派生新问题,绕开竞品强势语义正面战场。', actsOn: 'new-question' },
  },
  {
    id: 'SEMANTIC_IRRELEVANCE',
    label: '语义错位',
    description: '我方用词与用户提问词不在同一语义空间。',
    repairAction: { summary: '用用户真实提问词改写内容锚点与标题。', actsOn: 'this-question' },
  },
  {
    id: 'OUTDATED_CONTENT',
    label: '内容过时',
    description: 'AI 引用了过时的价格 / EOL / 定位。',
    repairAction: { summary: '发布带时间戳的更新内容,标注失效旧信息。', actsOn: 'this-question' },
  },
  {
    id: 'TRUST_CREDIBILITY',
    label: '信任缺失',
    description: '没有 GitHub / arXiv / 官方文档等可信引用支撑。',
    repairAction: { summary: '建设第三方可信信号:开源仓库、论文引用、权威背书。', actsOn: 'this-question' },
  },
  {
    id: 'STRUCTURAL_WEAKNESS',
    label: '结构薄弱',
    description: '内容有答案但缺 BLUF / 片段友好结构。',
    repairAction: { summary: '重构为片段友好结构(表格 / 列表 / 代码块 / 结论前置)。', actsOn: 'this-question' },
  },
  {
    id: 'UNKNOWN',
    label: '未知 / 无显著失败',
    description: '未识别到明显失败(通常 ST 已强绑定)。',
    repairAction: { summary: '无需修复;转守位监测。', actsOn: 'this-question' },
  },
];

export const SEMICONDUCTOR_FRAMEWORK_V1: IntentFrameworkDefinition = {
  id: 'semiconductor-b2b',
  version: 'v1.0.0',
  label: '半导体 B2B 意图框架',
  description: '半导体 B2B GEO campaign 的固定意图坐标系:7 个工程决策维度 + 9 类根因诊断。',
  dimensions: SEMI_DIMENSIONS,
  rootCauses: SEMI_ROOT_CAUSES,
};

// ─── Registry (keyed by id@version; never delete old versions) ───────────────

const FRAMEWORK_REGISTRY: Record<string, IntentFrameworkDefinition> = {
  'semiconductor-b2b@v1.0.0': SEMICONDUCTOR_FRAMEWORK_V1,
  // Future evolution → add 'semiconductor-b2b@v2.0.0'; keep v1.0.0 forever.
};

export const DEFAULT_FRAMEWORK_ID = SEMICONDUCTOR_FRAMEWORK_V1.id;
export const DEFAULT_FRAMEWORK_VERSION = SEMICONDUCTOR_FRAMEWORK_V1.version;
export const DEFAULT_FRAMEWORK = SEMICONDUCTOR_FRAMEWORK_V1;

// ─── Resolvers (all lookups go through these — never hardcode names) ─────────

/** Resolve the exact frozen version. Returns null if that version isn't registered. */
export function resolveFramework(id: string, version: string): IntentFrameworkDefinition | null {
  return FRAMEWORK_REGISTRY[`${id}@${version}`] ?? null;
}

export function getDimension(
  fw: IntentFrameworkDefinition,
  dimId: string,
): EngineeringDimension | null {
  return fw.dimensions.find(d => d.id === dimId) ?? null;
}

export function getRootCause(
  fw: IntentFrameworkDefinition,
  rcId: string,
): RootCauseType | null {
  return fw.rootCauses.find(r => r.id === rcId) ?? null;
}

export function isValidDimensionId(fw: IntentFrameworkDefinition, dimId: string): boolean {
  return fw.dimensions.some(d => d.id === dimId);
}

// ─── Deterministic dimension grouping (replaces LLM re-clustering) ────────────

/**
 * Build intent groups deterministically from each question's dimensionId, using
 * the (frozen) framework for stable ids + labels. This is what makes re-probe
 * delta alignment stable: groups key on framework dimensions, not ephemeral LLM
 * clusters. Group id === dimensionId. Questions with a missing / invalid
 * dimensionId fall into the surfaced UNASSIGNED bucket (Q4 + Q7).
 */
export function buildDimensionGroups(
  questions: SeedQuestion[],
  fw: IntentFrameworkDefinition | null,
): IntentGroup[] {
  const byDim = new Map<string, string[]>();
  for (const q of questions) {
    const valid = q.dimensionId && (!fw || isValidDimensionId(fw, q.dimensionId));
    const dimId = valid ? q.dimensionId : UNASSIGNED_DIMENSION_ID;
    if (!byDim.has(dimId)) byDim.set(dimId, []);
    byDim.get(dimId)!.push(q.id);
  }

  const groups: IntentGroup[] = [];
  const orderedDimIds = fw ? fw.dimensions.map(d => d.id) : [];

  // Framework-defined dimensions first, in framework order.
  for (const dimId of orderedDimIds) {
    const qids = byDim.get(dimId);
    if (!qids?.length) continue;
    const dim = fw ? getDimension(fw, dimId) : null;
    groups.push({
      id: dimId,
      label: dim?.label ?? dimId,
      questionIds: qids,
      description: dim?.description,
    });
  }

  // Anything outside the framework order (defensive) + the unassigned bucket last.
  for (const [dimId, qids] of byDim) {
    if (orderedDimIds.includes(dimId)) continue;
    groups.push({
      id: dimId,
      label: dimId === UNASSIGNED_DIMENSION_ID ? UNASSIGNED_DIMENSION_LABEL : dimId,
      questionIds: qids,
    });
  }

  return groups;
}
