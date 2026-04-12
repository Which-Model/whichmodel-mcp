/**
 * CLI script: Seed the database with model data from OpenRouter.
 *
 * Usage: npm run seed
 */
import { getSupabaseServiceClient } from '../db/client.js';
import { upsertModel } from '../db/models.js';
import { fetchOpenRouterModels } from './openrouter.js';
import { transformOpenRouterModel } from './transform.js';
import { computeValueScore } from '@which-model/whichmodel-core';
import { INCLUDED_PROVIDER_PREFIXES } from './known-models.js';

async function seed() {
  console.log('Fetching models from OpenRouter...');
  const rawModels = await fetchOpenRouterModels();
  console.log(`Fetched ${rawModels.length} models from OpenRouter`);

  // Filter to included providers
  const filtered = rawModels.filter((m) => {
    const provider = m.id.split('/')[0] ?? '';
    return INCLUDED_PROVIDER_PREFIXES.some((prefix) => provider === prefix);
  });
  console.log(`Filtered to ${filtered.length} models from included providers`);

  // Filter out free/broken models (zero pricing for both input and output)
  const viable = filtered.filter((m) => {
    const prompt = parseFloat(m.pricing.prompt) || 0;
    const completion = parseFloat(m.pricing.completion) || 0;
    return prompt > 0 || completion > 0;
  });
  console.log(`${viable.length} models with non-zero pricing`);

  const supabase = getSupabaseServiceClient();
  let seeded = 0;

  for (const raw of viable) {
    try {
      const model = transformOpenRouterModel(raw);
      model.value_score = computeValueScore(model);
      await upsertModel(supabase, model);
      seeded++;
      if (seeded % 10 === 0) {
        console.log(`  Seeded ${seeded} models...`);
      }
    } catch (err) {
      console.error(`  Failed to seed ${raw.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nDone. Seeded ${seeded} models.`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
