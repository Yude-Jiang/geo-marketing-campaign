/**
 * Intent framework definition — the configurable, versioned skeleton that
 * anchors the intent coordinate system.
 *
 * Three layers (see docs/campaign-pipeline-master-spec.md + REFACTOR-PLAN-01.md):
 *   • EngineeringDimension[] — stable coordinate system (freeze / alignment anchor)
 *   • RootCauseType[]        — root-cause taxonomy + repair-action definitions
 *   • SemanticAnchor         — lives per-question in types/campaign.ts
 *
 * A framework is CONFIGURABLE DATA, not a hardcoded enum. Swapping industries =
 * add a new definition to the registry (config/intentFramework.ts). Core code
 * references dimensions / root-causes BY ID only — it must never branch on their
 * names. This is hard-constraint #1 of the refactor.
 */

/** Bottom layer: an engineering trade-off dimension. Stable across re-probes. */
export interface EngineeringDimension {
  /** Stable id, e.g. 'cost-performance'. All code references dimensions by id. */
  id: string;
  label: string;
  description: string;
}

/**
 * Suggested repair action for a root cause. Defined this knife; NOT yet wired to
 * content generation (out of scope — see REFACTOR-PLAN-01 §"不在本刀范围").
 */
export interface RepairAction {
  summary: string;
  /**
   * Which question the repair acts on:
   *  • 'this-question' — fix content for the same monitoring question.
   *  • 'new-question'  — derive a NEW question (COMPETITOR_DOMINANCE: change angle /
   *                      semantic derivation). The derivation flow is intentionally
   *                      NOT implemented this knife — only the definition is stored.
   */
  actsOn: 'this-question' | 'new-question';
}

/** Middle layer: a root-cause type. `id` reuses GeoFailureCategory literals (types.ts). */
export interface RootCauseType {
  id: string;
  label: string;
  description: string;
  repairAction: RepairAction;
}

/** A complete, versioned framework instance. Semiconductor is the first seed. */
export interface IntentFrameworkDefinition {
  /** e.g. 'semiconductor-b2b' */
  id: string;
  /** Semantic version, e.g. 'v1.0.0'. A campaign binds this exact version at freeze time. */
  version: string;
  label: string;
  description: string;
  dimensions: EngineeringDimension[];
  rootCauses: RootCauseType[];
}
