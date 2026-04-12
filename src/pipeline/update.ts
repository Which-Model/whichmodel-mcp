/**
 * CLI script: Update prices and detect changes.
 *
 * Usage: npm run update-prices
 */
import { getSupabaseServiceClient } from '../db/client.js';
import { getAllActiveModels, upsertModel } from '../db/models.js';
import { insertPriceChange } from '../db/price-history.js';
import { fetchOpenRouterModels } from './openrouter.js';
import { transformOpenRouterModel } from './transform.js';
import { computeValueScore } from '@which-model/whichmodel-core';
import { INCLUDED_PROVIDER_PREFIXES } from './known-models.js';

async function update() {
  const supabase = getSupabaseServiceClient();

  console.log('Fetching current models from database...');
  const existingModels = await getAllActiveModels(supabase);
  const existingMap = new Map(existingModels.map((m) => [m.model_id, m]));
  console.log(`Found ${existingModels.length} models in database`);

  console.log('Fetching latest data from OpenRouter...');
  const rawModels = await fetchOpenRouterModels();

  const filtered = rawModels.filter((m) => {
    const provider = m.id.split('/')[0] ?? '';
    return INCLUDED_PROVIDER_PREFIXES.some((prefix) => provider === prefix);
  });

  const viable = filtered.filter((m) => {
    const prompt = parseFloat(m.pricing.prompt) || 0;
    const completion = parseFloat(m.pricing.completion) || 0;
    return prompt > 0 || completion > 0;
  });

  let updated = 0;
  let priceChanges = 0;
  let newModels = 0;

  for (const raw of viable) {
    try {
      const model = transformOpenRouterModel(raw);
      model.value_score = computeValueScore(model);
      const existing = existingMap.get(model.model_id);

      if (existing) {
        // Check for price changes
        const fields: Array<{ field: string; oldVal: number; newVal: number }> = [];

        if (Math.abs(existing.pricing_prompt - model.pricing_prompt) > 1e-15) {
          fields.push({
            field: 'pricing_prompt',
            oldVal: existing.pricing_prompt,
            newVal: model.pricing_prompt,
          });
        }
        if (Math.abs(existing.pricing_completion - model.pricing_completion) > 1e-15) {
          fields.push({
            field: 'pricing_completion',
            oldVal: existing.pricing_completion,
            newVal: model.pricing_completion,
          });
        }

        for (const change of fields) {
          const changePct =
            change.oldVal === 0
              ? 100
              : ((change.newVal - change.oldVal) / change.oldVal) * 100;

          await insertPriceChange(supabase, {
            model_id: model.model_id,
            field_changed: change.field,
            old_value: change.oldVal,
            new_value: change.newVal,
            change_pct: changePct,
          });
          priceChanges++;
          console.log(
            `  Price change: ${model.model_id} ${change.field} ` +
            `${change.oldVal} → ${change.newVal} (${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%)`,
          );
        }
      } else {
        newModels++;
        console.log(`  New model: ${model.model_id}`);
      }

      await upsertModel(supabase, model);
      updated++;
    } catch (err) {
      console.error(`  Failed to update ${raw.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nDone. Updated ${updated} models, ${priceChanges} price changes, ${newModels} new models.`);
}

update().catch((err) => {
  console.error('Update failed:', err);
  process.exit(1);
});
