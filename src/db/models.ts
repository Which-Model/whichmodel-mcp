import type { SupabaseClient } from '@supabase/supabase-js';
import type { Model, ModelCapabilities, PricingFilter, Capability } from '@which-model/whichmodel-core';

/**
 * Parse a raw Supabase row into a typed Model.
 * Supabase returns JSONB as objects and arrays natively.
 */
function parseRow(row: Record<string, unknown>): Model {
  return {
    model_id: row.model_id as string,
    provider: row.provider as string,
    display_name: row.display_name as string,
    description: (row.description as string) ?? null,
    context_length: row.context_length as number,
    max_output_tokens: (row.max_output_tokens as number) ?? null,
    modality: row.modality as string,
    pricing_prompt: row.pricing_prompt as number,
    pricing_completion: row.pricing_completion as number,
    pricing_image: (row.pricing_image as number) ?? null,
    pricing_request: (row.pricing_request as number) ?? null,
    capabilities: row.capabilities as ModelCapabilities,
    supported_parameters: (row.supported_parameters as string[]) ?? [],
    quality_tier: row.quality_tier as Model['quality_tier'],
    quality_confidence: (row.quality_confidence as Model['quality_confidence']) ?? null,
    value_score: (row.value_score as number) ?? null,
    is_active: row.is_active as boolean,
    availability_status: (row.availability_status as Model['availability_status']) ?? 'active',
    deprecated_at: (row.deprecated_at as string) ?? null,
    consecutive_missing_runs: (row.consecutive_missing_runs as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function getAllActiveModels(supabase: SupabaseClient): Promise<Model[]> {
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .eq('is_active', true)
    .order('value_score', { ascending: false, nullsFirst: false });

  if (error) throw new Error(`Failed to fetch models: ${error.message}`);
  return (data ?? []).map(parseRow);
}

export async function getModelById(supabase: SupabaseClient, modelId: string): Promise<Model | null> {
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .eq('model_id', modelId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw new Error(`Failed to fetch model ${modelId}: ${error.message}`);
  }
  return data ? parseRow(data) : null;
}

export async function getModelsByIds(supabase: SupabaseClient, modelIds: string[]): Promise<Model[]> {
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .in('model_id', modelIds);

  if (error) throw new Error(`Failed to fetch models: ${error.message}`);
  return (data ?? []).map(parseRow);
}

export async function getModelsByFilter(supabase: SupabaseClient, filter: PricingFilter): Promise<Model[]> {
  let query = supabase
    .from('models')
    .select('*')
    .eq('is_active', true);

  if (filter.model_id) {
    query = query.eq('model_id', filter.model_id);
  }
  if (filter.provider) {
    query = query.eq('provider', filter.provider);
  }
  if (filter.max_input_price != null) {
    // max_input_price is per million tokens, DB stores per-token
    const perToken = filter.max_input_price / 1_000_000;
    query = query.lte('pricing_prompt', perToken);
  }
  if (filter.min_context_window != null) {
    query = query.gte('context_length', filter.min_context_window);
  }

  query = query.order('pricing_prompt', { ascending: true });

  if (filter.limit) {
    query = query.limit(filter.limit);
  } else {
    query = query.limit(50);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to filter models: ${error.message}`);

  let models = (data ?? []).map(parseRow);

  // Filter by capabilities in application code (JSONB containment queries are complex)
  if (filter.capabilities && filter.capabilities.length > 0) {
    models = models.filter((m) =>
      filter.capabilities!.every((cap: Capability) => m.capabilities[cap]),
    );
  }

  return models;
}

export async function upsertModel(
  supabase: SupabaseClient,
  model: Omit<Model, 'created_at' | 'updated_at'>,
): Promise<void> {
  const { error } = await supabase
    .from('models')
    .upsert(
      {
        ...model,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'model_id' },
    );

  if (error) throw new Error(`Failed to upsert model ${model.model_id}: ${error.message}`);
}

/**
 * Get all models including deprecated ones (for pipeline use).
 */
export async function getAllModelsForPipeline(supabase: SupabaseClient): Promise<Model[]> {
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .order('model_id', { ascending: true });

  if (error) throw new Error(`Failed to fetch models for pipeline: ${error.message}`);
  return (data ?? []).map(parseRow);
}

/**
 * Increment the consecutive_missing_runs counter for a model.
 * Returns 'deprecated' if the threshold was reached, 'incremented' otherwise.
 */
export async function incrementMissingRuns(
  supabase: SupabaseClient,
  modelId: string,
  currentMissingRuns: number,
  threshold: number,
): Promise<'deprecated' | 'incremented'> {
  const newCount = currentMissingRuns + 1;

  if (newCount >= threshold) {
    const { error } = await supabase
      .from('models')
      .update({
        consecutive_missing_runs: newCount,
        availability_status: 'deprecated',
        deprecated_at: new Date().toISOString(),
        is_active: false,
      })
      .eq('model_id', modelId);

    if (error) throw new Error(`Failed to deprecate model ${modelId}: ${error.message}`);
    return 'deprecated';
  }

  const { error } = await supabase
    .from('models')
    .update({ consecutive_missing_runs: newCount })
    .eq('model_id', modelId);

  if (error) throw new Error(`Failed to increment missing runs for ${modelId}: ${error.message}`);
  return 'incremented';
}

/**
 * Reset missing runs counter and reactivate a model.
 */
export async function resetMissingRuns(
  supabase: SupabaseClient,
  modelId: string,
): Promise<void> {
  const { error } = await supabase
    .from('models')
    .update({
      consecutive_missing_runs: 0,
      availability_status: 'active',
      deprecated_at: null,
      is_active: true,
    })
    .eq('model_id', modelId);

  if (error) throw new Error(`Failed to reset missing runs for ${modelId}: ${error.message}`);
}

export async function getDataFreshness(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from('models')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return 'unknown';
  return data.updated_at as string;
}
