import type { SupabaseClient } from '@supabase/supabase-js';
import { getSubscribersForEvent } from './db.js';
import { notificationActionsKeyboard } from './keyboards.js';
import type { PriceChange } from '../engine/types.js';

const TELEGRAM_API = 'https://api.telegram.org';

interface SendMessageOptions {
  chat_id: number;
  text: string;
  parse_mode?: 'Markdown' | 'HTML';
  reply_markup?: unknown;
}

async function sendTelegramMessage(
  botToken: string,
  options: SendMessageOptions,
): Promise<boolean> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    if (!res.ok) {
      console.error(`Telegram send failed (${res.status}):`, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Telegram send error:', err);
    return false;
  }
}

/** Notify subscribers about price changes. */
export async function notifyPriceChanges(
  supabase: SupabaseClient,
  botToken: string,
  changes: PriceChange[],
): Promise<{ sent: number; failed: number }> {
  if (changes.length === 0) return { sent: 0, failed: 0 };

  const subscribers = await getSubscribersForEvent(supabase, 'price_change');
  let sent = 0;
  let failed = 0;

  for (const sub of subscribers) {
    // Filter changes by subscriber preferences
    const relevant = changes.filter((c) => {
      if (sub.providers && sub.providers.length > 0) {
        const provider = c.model_id.split('/')[0];
        if (!sub.providers.includes(provider)) return false;
      }
      if (sub.min_change_pct != null && c.percent_change != null) {
        if (Math.abs(c.percent_change) < sub.min_change_pct) return false;
      }
      return true;
    });

    if (relevant.length === 0) continue;

    let msg = `📊 *Price Changes Detected*\n\n`;
    const shown = relevant.slice(0, 10);
    for (const c of shown) {
      const icon = c.change_type === 'price_decrease' ? '📉' : '📈';
      msg += `${icon} *${c.model_id}*\n  ${c.note}\n\n`;
    }
    if (relevant.length > 10) {
      msg += `_...and ${relevant.length - 10} more_\n`;
    }

    const ok = await sendTelegramMessage(botToken, {
      chat_id: sub.telegram_chat_id,
      text: msg,
      parse_mode: 'Markdown',
      reply_markup: notificationActionsKeyboard('price'),
    });
    if (ok) sent++;
    else failed++;
  }

  return { sent, failed };
}

/** Notify subscribers about new models. */
export async function notifyNewModels(
  supabase: SupabaseClient,
  botToken: string,
  modelIds: string[],
): Promise<{ sent: number; failed: number }> {
  if (modelIds.length === 0) return { sent: 0, failed: 0 };

  const subscribers = await getSubscribersForEvent(supabase, 'new_model');
  let sent = 0;
  let failed = 0;

  let msg = `🆕 *New Models Detected*\n\n`;
  for (const id of modelIds.slice(0, 15)) {
    msg += `• \`${id}\`\n`;
  }
  if (modelIds.length > 15) {
    msg += `_...and ${modelIds.length - 15} more_\n`;
  }
  msg += '\n_Use /pricing <provider> for details_';

  for (const sub of subscribers) {
    const ok = await sendTelegramMessage(botToken, {
      chat_id: sub.telegram_chat_id,
      text: msg,
      parse_mode: 'Markdown',
      reply_markup: notificationActionsKeyboard('new_model'),
    });
    if (ok) sent++;
    else failed++;
  }

  return { sent, failed };
}

/** Notify subscribers about model deprecations. */
export async function notifyDeprecations(
  supabase: SupabaseClient,
  botToken: string,
  modelIds: string[],
): Promise<{ sent: number; failed: number }> {
  if (modelIds.length === 0) return { sent: 0, failed: 0 };

  const subscribers = await getSubscribersForEvent(supabase, 'deprecation');
  let sent = 0;
  let failed = 0;

  let msg = `⚠️ *Models Deprecated*\n\n`;
  for (const id of modelIds.slice(0, 15)) {
    msg += `• \`${id}\`\n`;
  }
  msg += '\n_These models are no longer available via OpenRouter._';

  for (const sub of subscribers) {
    const ok = await sendTelegramMessage(botToken, {
      chat_id: sub.telegram_chat_id,
      text: msg,
      parse_mode: 'Markdown',
    });
    if (ok) sent++;
    else failed++;
  }

  return { sent, failed };
}

/** Notify subscribers about capability test failures. */
export async function notifyCapabilityFailures(
  supabase: SupabaseClient,
  botToken: string,
  failures: Array<{ model_id: string; capability: string; error: string }>,
): Promise<{ sent: number; failed: number }> {
  if (failures.length === 0) return { sent: 0, failed: 0 };

  const subscribers = await getSubscribersForEvent(supabase, 'capability_failure');
  let sent = 0;
  let failed = 0;

  let msg = `🔴 *Capability Test Failures*\n\n`;
  for (const f of failures.slice(0, 10)) {
    msg += `• *${f.model_id}*: ${f.capability} failed\n  _${f.error}_\n\n`;
  }
  if (failures.length > 10) {
    msg += `_...and ${failures.length - 10} more_\n`;
  }

  for (const sub of subscribers) {
    const ok = await sendTelegramMessage(botToken, {
      chat_id: sub.telegram_chat_id,
      text: msg,
      parse_mode: 'Markdown',
    });
    if (ok) sent++;
    else failed++;
  }

  return { sent, failed };
}
