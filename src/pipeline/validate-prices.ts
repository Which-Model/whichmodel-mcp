/**
 * Multi-source price validation.
 *
 * Compares prices from different sources (OpenRouter, provider-direct)
 * and flags discrepancies.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Model } from '@which-model/whichmodel-core';

export interface ValidationResult {
  modelsChecked: number;
  discrepanciesFound: number;
  pricesCorrected: number;
}

export async function validatePrices(
  supabase: SupabaseClient,
  modelMap: Map<string, Model>,
): Promise<ValidationResult> {
  // TODO: Implement multi-source validation
  return { modelsChecked: 0, discrepanciesFound: 0, pricesCorrected: 0 };
}
