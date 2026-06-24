
export interface MonitoringQuestion {
  id: string; // unique ID for selection
  userPrompt: string; // The specific complex question an engineer asks AI (e.g. "Can I swap M0+ for M33 without increasing my BOM cost?")
  expectedAnchor: string; // The exact entity/data AI MUST cite (e.g. "STM32C5 or $0.64 entry price cited")
}

export interface StrategicPlaybookItem {
  sourceLogic: string; // Core contradiction & entities
  tacticsType: string; // Authority / Scenario / Counter-Competitor
  contentPlatform: string; // Where & What (e.g., Zhihu, Reddit, Naver Blog)
  structuredDataStrategy: string; // How to Format (e.g., Listicle, Table, Code Block)
  geoAction: string; // Specific GEO Action
  targetSnippet: string; // The "Gold" Target Snippet for AI Answer Box
  anchorIds: string[]; // IDs of MonitoringQuestions this playbook directly addresses
}

export type EvidenceAuthority = 'high' | 'medium' | 'low';
export type EvidenceRecency  = 'fresh' | 'stale' | 'unknown';

export interface EvidenceQuality {
  authority: EvidenceAuthority; // based on domain signals (GitHub/arXiv/official = high)
  recency: EvidenceRecency;     // based on URL date patterns
  anchorMatch: boolean;         // whether source text contains the anchor keyword
  score: number;                // composite 0-1 for sorting
}

export interface ScoredEvidenceSource {
  type: 'file' | 'url' | 'system';
  name: string;
  content: string;
  urls: { title: string; uri: string }[];
  quality: EvidenceQuality;
}

// Serialisable RAG source — stored in localStorage so sources survive page refresh.
// File objects cannot be serialised; we store the extracted text content instead.
export interface PersistedRagSource {
  type: 'file' | 'url';
  name: string;
  content: string;
  wordCount: number;
}

export interface PlaybookAnchorBundle {
  playbook: StrategicPlaybookItem;
  anchors: MonitoringQuestion[]; // Resolved anchor objects bound to this playbook
}

export interface RoleSpecificSop {
  roleName: string;
  coreFocus: string;
  sopTitle: string;
  actionableGuide: string;
  badExample: string;
  goodExample: string;
  checklist: string[];
}

export interface MarketStrategy {
  comprehensiveInsight: {
    aiPerception: string; // Current perception in local AI platforms
    marketGapAnalysis: string; // Market gap for Cognitive Sovereignty
  };
  
  // GEO Playbooks based on the 3-Step Workflow
  implicitIntentStrategy: StrategicPlaybookItem[]; // Based on Table D
  competitorStrategy: StrategicPlaybookItem[]; // Based on Table E

  roleSpecificSops: RoleSpecificSop[];
}

export interface ExecutiveSummaryDimensions {
  marketPulse: string;    // 数据时效与认知现状 (Market Status)
  coreRoadblocks: string; // 核心阻碍 (Why AI doesn't pick us)
  strategicPivot: string; // 战略转向 (SEO -> GEO)
  keyInsight: string;     // 关键洞察 (Counter-intuitive finding)
}

export interface StrategyReport {
  executiveSummary: ExecutiveSummaryDimensions;
  actionPlan: string[]; // Step-by-step GEO tasks
}

export interface CompetitorInsight {
  competitorName: string; 
  aiPerception: string;      // Current AI bias/preference
  corpusAdvantage: string;   // 竞品胜出的底层语料逻辑 (Why AI prefers them)
  threatLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  strategicOpening: string;  // 战略切入点 (How we counter this specific gap)
}

export interface GroundingUrl {
  title: string;
  uri: string;
}

// ─── GEO Failure Taxonomy ────────────────────────────────────────────────────
// Adapted from AgentGEO's 14-category system (arxiv 2311.09735) and mapped to
// semiconductor B2B GEO context. Each category drives a different repair strategy.
export type GeoFailureCategory =
  | 'CORPUS_ABSENCE'        // AI training data has no signal about this product/feature (≈ DATA_INTEGRITY + LOW_INFO_DENSITY)
  | 'ATTRIBUTE_MISMATCH'    // AI knows the product but cites wrong price/spec/positioning
  | 'BURIED_ANSWER'         // Content has the answer but it's in PDFs/datasheets AI can't crawl
  | 'COMPETITOR_DOMINANCE'  // Competitor corpus density far exceeds yours; AI defaults to them
  | 'SEMANTIC_IRRELEVANCE'  // Your content uses "wireless MCU" but users ask "low power BLE SoC"
  | 'OUTDATED_CONTENT'      // AI cites your 2022 pricing/EOL status / obsolete positioning
  | 'TRUST_CREDIBILITY'     // No GitHub repos, arXiv citations, or official docs referencing you
  | 'STRUCTURAL_WEAKNESS'   // Content exists but lacks BLUF / snippet-friendly structure
  | 'UNKNOWN';

export interface ClusterFailureDiagnosis {
  primaryFailure: GeoFailureCategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** One concrete sentence explaining WHY this failure applies to this specific cluster */
  explanation: string;
  /** 1–10: drives Playbook selection priority (10 = fix this first) */
  repairUrgency: number;
}

export interface IntentCluster {
  intentName: string;           // e.g., "Intent 1 · BOM-Neutral M0+ → M33 Architecture Migration"
  coreProposition: string;       // e.g., "At $0.64 entry price, the M33 is expensive anchor no longer holds."
  monitoringQuestions: MonitoringQuestion[]; // The specific interception checkpoints
  failureDiagnosis?: ClusterFailureDiagnosis; // Root-cause failure category for this cluster
}

export type AnchorVerificationStatus = 'verified' | 'partial' | 'unverified';

export interface AnchorVerificationResult {
  anchorId: string;
  anchor: string;           // the expectedAnchor text
  status: AnchorVerificationStatus;
  supportingUrls: string[]; // URLs where the anchor was found
  confidence: number;       // 0-1
}

export interface ModelClaimVerification {
  claim: string;          // The specific AI model preference claim extracted
  evidenceFound: boolean; // Whether Google Search found supporting evidence
  sourceUrls: string[];   // URLs that corroborate (or failed to find)
}

export interface ModelVerificationResult {
  disclaimer: string;     // Human-readable disclaimer about simulation nature
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  verifiedClaims: ModelClaimVerification[];
  searchedAt: string;     // ISO timestamp of when verification ran
}

export interface AnalysisResult {
  strategyReport: StrategyReport;
  intentClusters: IntentCluster[];
  competitorAnalysis: CompetitorInsight[]; // Added array for Battle Cards
  marketStrategy: MarketStrategy;
  groundingUrls?: GroundingUrl[]; // Sources from Google Search
  modelVerification?: ModelVerificationResult;
  multiModelVerification?: import('./services/multiModelService').MultiModelVerificationResult;
  anchorVerifications?: AnchorVerificationResult[];     // Per-anchor real-world validation
}

export type IntentCategory = 
  | 'Academic/Cognition'
  | 'Application/Solution'
  | 'Reliability/Risk'
  | 'Commercial/Selection';

export const EXAMPLE_TERMS = `STM32WBA Matter Thread
nRF52832 Alternative Low Power
Bluetooth LE PSA Level 3 Certification
Matter Smart Lock Single Chip Solution
Industrial Temp Bluetooth SoC Selection for EMEA`;

// Campaign planning pipeline (SeedQuestion → QuestionProbe → IntentGroupDiagnosis → CampaignSynthesis)
export type * from './types/campaign';