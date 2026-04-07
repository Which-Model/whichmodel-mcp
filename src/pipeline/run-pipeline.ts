/**
 * Shared pricing pipeline runner.
 *
 * Used by both the CLI script (update.ts) and the Cloudflare Worker
 * scheduled handler (worker.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAllModelsForPipeline, upsertModel, incrementMissingRuns, resetMissingRuns } from '../db/models.js';
import { insertPriceChange, recordNewModelEvent } from '../db/price-history.js';
import { fetchOpenRouterModels } from './openrouter.js';
import { transformOpenRouterModel } from './transform.js';
import { computeValueScore } from '../engine/value-score.js';
import { INCLUDED_PROVIDER_PREFIXES } from './known-models.js';
import { runProviderDirectIngestion, type ProviderDirectResult } from './provider-direct.js';
import { validatePrices, type ValidationResult } from './validate-prices.js';
import { runBenchmarkPipeline, type BenchmarkPipelineResult } from './benchmarks.js';

const DEPRECATION_THRESHOLD = 3;

export interface PipelineResult {
  updated: number;
  priceChanges: number;
  newModels: number;
  deprecated: number;
  reactivated: number;
  alerts: string[];
  providerDirect: ProviderDirectResult | null;
  validation: ValidationResult | null;
  benchmarks: BenchmarkPipelineResult | null;
}

export async function runPricingPipeline(supabase: SupabaseClient): Promise<PipelineResult> {
  console.log('Fetching current models from database...');
  const existingModels = await getAllModelsForPipeline(supabase);
  const existingMap = new Map(existingModels.map((m) => [m.model_id, m]));
  console.log(`Found ${existingModels.length} models in database (including deprecated)`);

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

  // Build a set of model IDs present in OpenRouter this run
  const openRouterModelIds = new Set(viable.map((m) => m.id));

  let updated = 0;
  let priceChanges = 0;
  let newModels = 0;
  let deprecated = 0;
  let reactivated = 0;
  const alerts: string[] = [];

  // ── Process models present in OpenRouter ──
  for (const raw of viable) {
    try {
      const model = transformOpenRouterModel(raw);
      model.value_score = computeValueScore(model);
      const existing = existingMap.get(model.model_id);

      if (existing) {
        // Model reappeared — reset missing counter if it was counting
        if (existing.consecutive_missing_runs > 0 || existing.availability_status !== 'active') {
          await resetMissingRuns(supabase, model.model_id);
          if (existing.availability_status === 'deprecated') {
            reactivated++;
            console.log(`  Reactivated: ${model.model_id} (was deprecated)`);
          }
        }

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

          // Alert on large price swings (>50%)
          if (Math.abs(changePct) > 50) {
            const msg = `Large price change: ${model.model_id} ${change.field} ${change.oldVal} → ${change.newVal} (${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%)`;
            alerts.push(msg);
            console.warn(`⚠ ${msg}`);
          }

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

      // Record new-model event for check_price_changes after upsert
      if (!existing) {
        await recordNewModelEvent(supabase, model.model_id, model.pricing_prompt, model.pricing_completion);
      }

      updated++;
    } catch (err) {
      console.error(`  Failed to update ${raw.id}:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Detect missing models and track deprecation ──
  for (const existing of existingModels) {
    if (existing.availability_status === 'sunset') continue;
    if (openRouterModelIds.has(existing.model_id)) continue;

    // Model is missing from OpenRouter this run
    try {
      const result = await incrementMissingRuns(
        supabase,
        existing.model_id,
        existing.consecutive_missing_runs,
        DEPRECATION_THRESHOLD,
      );

      if (result === 'deprecated') {
        deprecated++;
        const msg = `Model deprecated: ${existing.model_id} (missing from OpenRouter for ${DEPRECATION_THRESHOLD} consecutive runs)`;
        alerts.push(msg);
        console.warn(`⚠ ${msg}`);
      } else {
        console.log(
          `  Missing: ${existing.model_id} (${existing.consecutive_missing_runs + 1}/${DEPRECATION_THRESHOLD} runs)`,
        );
      }
    } catch (err) {
      console.error(`  Failed to track missing model ${existing.model_id}:`, err instanceof Error ? err.message : err);
    }
  }

  // Alert if too many models changed in a single run
  const totalChangedModels = priceChanges + newModels;
  if (totalChangedModels > 10) {
    const msg = `High churn: ${totalChangedModels} models changed (${priceChanges} price changes, ${newModels} new models)`;
    alerts.push(msg);
    console.warn(`⚠ ${msg}`);
  }

  console.log(`\nDone. Updated ${updated} models, ${priceChanges} price changes, ${newModels} new, ${deprecated} deprecated, ${reactivated} reactivated.`);
  if (alerts.length > 0) {
    console.warn(`\n⚠ ${alerts.length} alert(s):`);
    for (const alert of alerts) {
      console.warn(`  - ${alert}`);
    }
  }

  // ── Provider-direct price ingestion ──
  let providerDirect: ProviderDirectResult | null = null;
  try {
    console.log('\nRunning provider-direct price ingestion...');
    providerDirect = await runProviderDirectIngestion(supabase);
    console.log(`Provider-direct: ${providerDirect.totalStored} prices stored across ${providerDirect.sources.length} source(s).`);

    for (const src of providerDirect.sources) {
      if (src.errors.length > 0) {
        for (const err of src.errors) {
          alerts.push(`Provider-direct (${src.source}): ${err}`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alerts.push(`Provider-direct ingestion failed: ${msg}`);
    console.error(`Provider-direct ingestion failed: ${msg}`);
  }

  // ── Multi-source price validation ──
  let validation: ValidationResult | null = null;
  if (providerDirect && providerDirect.totalStored > 0) {
    try {
      console.log('\nRunning multi-source price validation...');
      // Rebuild the model map with current DB state (prices may have changed during this run)
      const currentModels = await getAllModelsForPipeline(supabase);
      const modelMap = new Map(currentModels.map((m) => [m.model_id, m]));
      validation = await validatePrices(supabase, modelMap);
      console.log(
        `Validation: ${validation.modelsChecked} models checked, ` +
        `${validation.discrepanciesFound} discrepancies found, ` +
        `${validation.pricesCorrected} prices corrected.`,
      );

      if (validation.discrepanciesFound > 0) {
        alerts.push(
          `Price validation: ${validation.discrepanciesFound} discrepancy/ies found across ${validation.modelsChecked} models (${validation.pricesCorrected} auto-corrected)`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alerts.push(`Price validation failed: ${msg}`);
      console.error(`Price validation failed: ${msg}`);
    }
  }

  // ── Benchmark data ingestion ──
  let benchmarks: BenchmarkPipelineResult | null = null;
  try {
    console.log('\nRunning benchmark data ingestion...');
    // Build set of known model IDs from the current DB state
    const currentModels = await getAllModelsForPipeline(supabase);
    const knownModelIds = new Set(currentModels.map((m) => m.model_id));
    benchmarks = await runBenchmarkPipeline(supabase, knownModelIds);
    console.log(`Benchmarks: ${benchmarks.totalStored} entries stored.`);

    for (const src of benchmarks.sources) {
      if (src.errors.length > 0) {
        for (const err of src.errors) {
          alerts.push(`Benchmark (${src.source}): ${err}`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alerts.push(`Benchmark ingestion failed: ${msg}`);
    console.error(`Benchmark ingestion failed: ${msg}`);
  }

  return { updated, priceChanges, newModels, deprecated, reactivated, alerts, providerDirect, validation, benchmarks };
}
