/**
 * Fallback cost estimation when hermes-agent doesn't report costs.
 * Source: https://artificialanalysis.ai + provider pricing pages.
 * Prices in USD per 1M tokens.
 */

interface ModelPricing {
  input: number;
  output: number;
}

const MODEL_PRICING: Array<{ pattern: RegExp; pricing: ModelPricing }> = [
  // Google — Gemini
  { pattern: /gemini-3\.1-pro/i,                pricing: { input: 2.00, output: 12.00 } },
  { pattern: /gemini-3\.0-flash/i,              pricing: { input: 0.15, output: 0.60 } },
  { pattern: /gemini-2\.5-pro/i,                pricing: { input: 1.25, output: 10.00 } },
  { pattern: /gemini-2\.5-flash/i,              pricing: { input: 0.15, output: 0.60 } },
  { pattern: /gemini-2\.0-flash/i,              pricing: { input: 0.10, output: 0.40 } },
  { pattern: /gemini/i,                         pricing: { input: 1.25, output: 5.00 } },
  // Anthropic — Claude
  { pattern: /claude-opus-4/i,                  pricing: { input: 15.00, output: 75.00 } },
  { pattern: /claude-sonnet-4/i,                pricing: { input: 3.00, output: 15.00 } },
  { pattern: /claude-3-7-sonnet|claude-3\.7/i,  pricing: { input: 3.00, output: 15.00 } },
  { pattern: /claude-3-5-sonnet|claude-3\.5/i,  pricing: { input: 3.00, output: 15.00 } },
  { pattern: /claude-3-5-haiku|claude-3\.5-h/i, pricing: { input: 0.80, output: 4.00 } },
  { pattern: /claude/i,                         pricing: { input: 3.00, output: 15.00 } },
  // OpenAI
  { pattern: /o3-mini/i,                        pricing: { input: 1.10, output: 4.40 } },
  { pattern: /o3/i,                             pricing: { input: 2.00, output: 8.00 } },
  { pattern: /o4-mini/i,                        pricing: { input: 1.10, output: 4.40 } },
  { pattern: /gpt-4\.1/i,                       pricing: { input: 2.00, output: 8.00 } },
  { pattern: /gpt-4o-mini/i,                    pricing: { input: 0.15, output: 0.60 } },
  { pattern: /gpt-4o/i,                         pricing: { input: 2.50, output: 10.00 } },
  { pattern: /gpt-4/i,                          pricing: { input: 2.50, output: 10.00 } },
];

export function estimateCost(model: string | null, inputTokens: number, outputTokens: number): number {
  if (!model) return 0;
  const match = MODEL_PRICING.find(m => m.pattern.test(model));
  if (!match) return 0;
  const { input, output } = match.pricing;
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}
