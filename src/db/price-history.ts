import type { SupabaseClient } from '@supabase/supabase-js';
import type { PriceHistoryEntry, PriceChange } from '../engine/types.js';

export async function insertPriceChange(
  supabase: SupabaseClient,
  entry: Omit<PriceHistoryEntry, 'id' | 'detected_at'>,
): Promise<void> {
  const { error } = await supabase.from('price_history').insert({
    model_id: entry.model_id,
    field_changed: entry.field_changed,
    old_value: entry.old_value,
    new_value: entry.new_value,
    change_pct: entry.change_pct,
  });

  if (error) throw new Error(`Failed to insert price change: ${error.message}`);
}

/**
 * Record a "new model" event so it surfaces in check_price_changes responses.
 */
export async function recordNewModelEvent(
  supabase: SupabaseClient,
  modelId: string,
  pricingPrompt: number,
  pricingCompletion: number,
): Promise<void> {
  // Insert two rows: one for prompt pricing, one for completion pricing.
  // old_value=0 signals this is a brand-new model (no prior price).
  const rows = [
    { model_id: modelId, field_changed: 'new_model', old_value: 0, new_value: pricingPrompt, change_pct: 100 },
    { model_id: modelId, field_changed: 'new_model_completion', old_value: 0, new_value: pricingCompletion, change_pct: 100 },
  ];

  const { error } = await supabase.from('price_history').insert(rows);
  if (error) throw new Error(`Failed to record new model event for ${modelId}: ${error.message}`);
}

export async function getPriceChangesSince(
  supabase: SupabaseClient,
  since: string,
  modelId?: string,
  provider?: string,
): Promise<PriceChange[]> {
  let query = supabase
    .from('price_history')
    .select('*, models!inner(provider, display_name)')
    .gte('detected_at', since)
    .order('detected_at', { ascending: false });

  if (modelId) {
    query = query.eq('model_id', modelId);
  }
  if (provider) {
    query = query.eq('models.provider', provider);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch price changes: ${error.message}`);

  // Deduplicate new-model events: collapse the two rows (new_model + new_model_completion)
  // into a single PriceChange entry per model.
  const newModelMap = new Map<string, { prompt: number; completion: number; detected_at: string }>();
  const priceRows: typeof data = [];

  for (const row of data ?? []) {
    const field = row.field_changed as string;
    if (field === 'new_model' || field === 'new_model_completion') {
      const key = `${row.model_id}:${row.detected_at}`;
      const entry = newModelMap.get(key) ?? { prompt: 0, completion: 0, detected_at: row.detected_at };
      if (field === 'new_model') entry.prompt = row.new_value;
      else entry.completion = row.new_value;
      newModelMap.set(key, entry);
    } else {
      priceRows.push(row);
    }
  }

  const results: PriceChange[] = [];

  // Add new-model entries
  for (const [key, entry] of newModelMap) {
    const modelId = key.split(':')[0];
    results.push({
      model_id: modelId,
      change_type: 'new_model',
      old_input_price: null,
      new_input_price: entry.prompt * 1_000_000,
      old_output_price: null,
      new_output_price: entry.completion * 1_000_000,
      percent_change: null,
      detected_at: entry.detected_at,
      note: 'New model detected (provisional quality tier)',
    });
  }

  // Add price-change entries
  for (const row of priceRows) {
    const field = row.field_changed as string;
    const isInput = field === 'pricing_prompt';
    const isOutput = field === 'pricing_completion';

    results.push({
      model_id: row.model_id,
      change_type: row.new_value > row.old_value ? 'price_increase' : 'price_decrease',
      old_input_price: isInput ? row.old_value * 1_000_000 : null,
      new_input_price: isInput ? row.new_value * 1_000_000 : null,
      old_output_price: isOutput ? row.old_value * 1_000_000 : null,
      new_output_price: isOutput ? row.new_value * 1_000_000 : null,
      percent_change: row.change_pct,
      detected_at: row.detected_at,
      note: `${field.replace('pricing_', '')} price ${row.new_value > row.old_value ? 'increased' : 'decreased'} by ${Math.abs(row.change_pct).toFixed(1)}%`,
    });
  }

  // Sort by detected_at descending
  results.sort((a, b) => b.detected_at.localeCompare(a.detected_at));

  return results;
}
