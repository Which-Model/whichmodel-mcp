/**
 * Lightweight new-model scan pipeline.
 *
 * Runs hourly (vs the full 4-hour pipeline) and only detects new model IDs
 * from OpenRouter. New models get a provisional quality tier until the full
 * pipeline with benchmarks confirms them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAllModelsForPipeline, upsertModel } from '../db/models.js';
import { fetchOpenRouterModels } from './openrouter.js';
import { transformOpenRouterModel } from './transform.js';
import { computeValueScore } from '../engine/value-score.js';
import { INCLUDED_PROVIDER_PREFIXES } from './known-models.js';
import { recordNewModelEvent } from '../db/price-history.js';

export interface NewModelScanResult {
  scanned: number;
  newModels: string[];
  alerts: string[];
}

export async function runNewModelScan(supabase: SupabaseClient): Promise<NewModelScanResult> {
  console.log('[new-model-scan] Fetching current model IDs from database...');
  const existingModels = await getAllModelsForPipeline(supabase);
  const existingIds = new Set(existingModels.map((m) => m.model_id));
  console.log(`[new-model-scan] ${existingIds.size} models in database`);

  console.log('[new-model-scan] Fetching latest data from OpenRouter...');
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

  const newModels: string[] = [];
  const alerts: string[] = [];

  for (const raw of viable) {
    if (existingIds.has(raw.id)) continue;

    try {
      // New model — transform with provisional quality tier (no benchmarks)
      const model = transformOpenRouterModel(raw);
      model.value_score = computeValueScore(model);

      await upsertModel(supabase, model);
      await recordNewModelEvent(supabase, model.model_id, model.pricing_prompt, model.pricing_completion);

      newModels.push(model.model_id);
      console.log(`[new-model-scan] New model: ${model.model_id} (tier=${model.quality_tier}, confidence=${model.quality_confidence})`);
    } catch (err) {
      const msg = `Failed to insert new model ${raw.id}: ${err instanceof Error ? err.message : String(err)}`;
      alerts.push(msg);
      console.error(`[new-model-scan] ${msg}`);
    }
  }

  if (newModels.length > 0) {
    const msg = `${newModels.length} new model(s) detected: ${newModels.join(', ')}`;
    alerts.push(msg);
    console.log(`[new-model-scan] ${msg}`);
  } else {
    console.log('[new-model-scan] No new models found.');
  }

  return { scanned: viable.length, newModels, alerts };
}
