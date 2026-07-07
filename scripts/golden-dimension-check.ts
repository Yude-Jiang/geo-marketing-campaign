/**
 * Golden-label dimension classification check (observation only).
 * Run: npx tsx scripts/golden-dimension-check.ts
 * Requires VITE_GEMINI_API_KEY via server or env.
 */
import { preprocessSeedQuestions } from '../src/services/campaignGeminiService';
import { DEFAULT_FRAMEWORK, UNASSIGNED_DIMENSION_ID } from '../src/config/intentFramework';

const TOPIC = 'SDV 区域控制器与配电架构';

const GOLDEN: { text: string; expected: string }[] = [
  { text: 'ECU软件迁移到区域控制器有哪些挑战?', expected: 'migration-compat' },
  { text: 'zonal架构是什么?', expected: UNASSIGNED_DIMENSION_ID },
  { text: '域控制器和ZCU有什么区别?', expected: UNASSIGNED_DIMENSION_ID },
  { text: '如何降低线束和配电成本?', expected: 'cost-performance' },
  { text: 'ZCU领域有哪些主要厂商?', expected: UNASSIGNED_DIMENSION_ID },
  { text: 'PDU需要哪些功率器件?', expected: UNASSIGNED_DIMENSION_ID },
  { text: 'PRS是什么?', expected: UNASSIGNED_DIMENSION_ID },
  { text: 'SDV配电架构有哪些方案?', expected: UNASSIGNED_DIMENSION_ID },
  { text: 'eFuse供应商有哪些?', expected: UNASSIGNED_DIMENSION_ID },
  { text: '区域控制器要不要做边缘AI?内置NPU能省什么?', expected: 'integration-simplification' },
];

async function main() {
  const texts = GOLDEN.map(g => g.text);
  const result = await preprocessSeedQuestions(
    TOPIC, texts, 'zh', 'cn', '中国', DEFAULT_FRAMEWORK,
  );

  let decisionHits = 0;
  let decisionTotal = 0;
  let sentinelHits = 0;
  let sentinelExpected = 0;

  console.log('\n| Q | LLM dimensionId | Gold | Match |');
  console.log('|---|-----------------|------|-------|');

  for (let i = 0; i < GOLDEN.length; i++) {
    const gold = GOLDEN[i];
    const q = result.questions[i];
    const got = q?.dimensionId ?? '(missing)';
    const match = got === gold.expected;
    const isSentinel = gold.expected === UNASSIGNED_DIMENSION_ID;
    if (isSentinel) {
      sentinelExpected++;
      if (got === UNASSIGNED_DIMENSION_ID) sentinelHits++;
    } else {
      decisionTotal++;
      if (match) decisionHits++;
    }
    console.log(`| ${i + 1} | ${got} | ${gold.expected} | ${match ? '✓' : '✗'} |`);
  }

  console.log(`\nDecision accuracy: ${decisionHits}/${decisionTotal}`);
  console.log(`Sentinel rate (landscape): ${sentinelHits}/${sentinelExpected} (≈7/10 honest)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
