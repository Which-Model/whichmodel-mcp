import type { Context } from 'grammy';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAllActiveModels, getDataFreshness } from '../db/models.js';
import { getPriceChangesSince } from '../db/price-history.js';
import { recommend } from '../engine/recommendation.js';
import type { TaskType } from '../engine/types.js';
import { TASK_TYPES } from '../engine/types.js';
import {
  getTelegramUserByChatId,
  createTelegramUser,
  consumeLinkToken,
  linkTelegramUserToApiKey,
  getNotificationPrefs,
  initDefaultPrefs,
  toggleNotificationPref,
} from './db.js';
import { alertsKeyboard } from './keyboards.js';
import type { NotificationEventType } from './types.js';
import { ALL_EVENT_TYPES, EVENT_TYPE_LABELS } from './types.js';

/** /start — register user and optionally link account via deep-link token */
export async function handleStart(ctx: Context, supabase: SupabaseClient): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const username = ctx.from?.username;
  const user = await createTelegramUser(supabase, chatId, username);

  // Check for deep-link token: /start <token>
  const text = ctx.message?.text ?? '';
  const parts = text.split(' ');
  if (parts.length > 1) {
    const token = parts[1].trim();
    const linkToken = await consumeLinkToken(supabase, token);
    if (linkToken) {
      await linkTelegramUserToApiKey(supabase, user.id, linkToken.api_key_id);
      await initDefaultPrefs(supabase, user.id);
      await ctx.reply(
        '✅ *Account linked successfully!*\n\n' +
        'Your WhichModel account is now connected. You\'ll receive notifications about price changes, new models, and more.\n\n' +
        'Use /alerts to manage your notification preferences.',
        { parse_mode: 'Markdown' },
      );
      return;
    } else {
      await ctx.reply(
        '⚠️ Invalid or expired link token. Please generate a new one from the WhichModel dashboard.\n\n' +
        'You can still use basic commands without linking.',
      );
    }
  }

  await ctx.reply(
    '👋 *Welcome to WhichModel Bot!*\n\n' +
    'I help you find the best LLM for your task at the best price.\n\n' +
    '*Commands:*\n' +
    '/help — Show available commands\n' +
    '/status — Service status and data freshness\n' +
    '/pricing <provider> — Get pricing for a provider\n' +
    '/recommend <task> — Get a model recommendation\n' +
    '/alerts — Manage notification preferences\n\n' +
    '_Link your account by using the deep-link from the WhichModel dashboard for personalized alerts._',
    { parse_mode: 'Markdown' },
  );
}

/** /help — show available commands */
export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    '*WhichModel Bot Commands*\n\n' +
    '`/status` — Check service status and data freshness\n' +
    '`/pricing <provider>` — View pricing for a specific provider\n' +
    '  _Examples: /pricing openai, /pricing anthropic_\n\n' +
    '`/recommend <task>` — Get the best model for a task type\n' +
    '  _Examples: /recommend code\\_generation, /recommend chat_\n' +
    `  _Available tasks: ${TASK_TYPES.join(', ')}_\n\n` +
    '`/alerts` — Manage your notification preferences\n' +
    '`/changes` — Recent price changes (last 24h)\n' +
    '`/help` — Show this message\n',
    { parse_mode: 'Markdown' },
  );
}

/** /status — service health and data freshness */
export async function handleStatus(ctx: Context, supabase: SupabaseClient): Promise<void> {
  try {
    const [freshness, modelsResult] = await Promise.all([
      getDataFreshness(supabase),
      supabase.from('models').select('availability_status', { count: 'exact', head: false }),
    ]);

    let active = 0;
    let deprecated = 0;
    if (modelsResult.data) {
      for (const row of modelsResult.data) {
        if (row.availability_status === 'active') active++;
        else if (row.availability_status === 'deprecated') deprecated++;
      }
    }

    const freshnessDate = freshness !== 'unknown'
      ? new Date(freshness).toLocaleString('en-US', { timeZone: 'UTC' })
      : 'unknown';

    await ctx.reply(
      '*WhichModel Status*\n\n' +
      `📊 Active models: *${active}*\n` +
      `⚠️ Deprecated: *${deprecated}*\n` +
      `🕐 Data freshness: ${freshnessDate} UTC\n` +
      `🔄 Pipeline: every 4 hours\n` +
      '✅ Service: operational',
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    console.error('Telegram /status error:', err);
    await ctx.reply('❌ Error fetching status. Service may be degraded.');
  }
}

/** /pricing <provider> — show pricing for a provider */
export async function handlePricing(ctx: Context, supabase: SupabaseClient): Promise<void> {
  const text = ctx.message?.text ?? '';
  const parts = text.split(/\s+/);
  const provider = parts[1]?.toLowerCase();

  if (!provider) {
    await ctx.reply(
      'Usage: `/pricing <provider>`\n_Example: /pricing openai_',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  try {
    const models = await getAllActiveModels(supabase);
    const filtered = models.filter(
      (m) => m.provider.toLowerCase().includes(provider),
    );

    if (filtered.length === 0) {
      await ctx.reply(`No active models found for provider "${provider}".`);
      return;
    }

    // Show top 10 by value score
    const top = filtered.slice(0, 10);
    let msg = `*Pricing: ${provider}* (top ${top.length} of ${filtered.length})\n\n`;

    for (const m of top) {
      const inputPrice = (m.pricing_prompt * 1_000_000).toFixed(2);
      const outputPrice = (m.pricing_completion * 1_000_000).toFixed(2);
      msg += `*${m.display_name}*\n`;
      msg += `  Input: $${inputPrice}/M · Output: $${outputPrice}/M\n`;
      msg += `  Tier: ${m.quality_tier} · Ctx: ${(m.context_length / 1000).toFixed(0)}K\n\n`;
    }

    if (filtered.length > 10) {
      msg += `_...and ${filtered.length - 10} more models_`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Telegram /pricing error:', err);
    await ctx.reply('❌ Error fetching pricing data.');
  }
}

/** /recommend <task_type> — get a model recommendation */
export async function handleRecommend(ctx: Context, supabase: SupabaseClient): Promise<void> {
  const text = ctx.message?.text ?? '';
  const parts = text.split(/\s+/);
  const taskInput = parts[1]?.toLowerCase();

  if (!taskInput) {
    await ctx.reply(
      'Usage: `/recommend <task_type>`\n' +
      `_Available: ${TASK_TYPES.join(', ')}_`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Fuzzy match task type
  const taskType = TASK_TYPES.find((t) => t.startsWith(taskInput) || t === taskInput);
  if (!taskType) {
    await ctx.reply(
      `Unknown task type "${taskInput}".\n_Available: ${TASK_TYPES.join(', ')}_`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  try {
    const [models, freshness] = await Promise.all([
      getAllActiveModels(supabase),
      getDataFreshness(supabase),
    ]);

    const result = recommend(models, { task_type: taskType as TaskType, complexity: 'medium' }, freshness);

    let msg = `*Recommendation for: ${taskType}*\n\n`;

    const rec = result.recommended;
    if (rec.model_id !== 'none') {
      msg += `🏆 *${rec.display_name}*\n`;
      msg += `  Provider: ${rec.provider}\n`;
      msg += `  Input: $${rec.input_price_per_mtok.toFixed(2)}/M · Output: $${rec.output_price_per_mtok.toFixed(2)}/M\n`;
      msg += `  Tier: ${rec.quality_tier} · Score: ${rec.score}\n\n`;
    } else {
      msg += '❌ No matching model found.\n\n';
    }

    if (result.alternative) {
      const alt = result.alternative;
      msg += `🔄 *Alternative: ${alt.display_name}*\n`;
      msg += `  $${alt.input_price_per_mtok.toFixed(2)}/$${alt.output_price_per_mtok.toFixed(2)} per M · ${alt.quality_tier}\n\n`;
    }

    if (result.budget_model) {
      const bud = result.budget_model;
      msg += `💰 *Budget: ${bud.display_name}*\n`;
      msg += `  $${bud.input_price_per_mtok.toFixed(2)}/$${bud.output_price_per_mtok.toFixed(2)} per M · ${bud.quality_tier}\n`;
    }

    msg += `\n_Confidence: ${result.confidence} · Data: ${new Date(freshness).toLocaleDateString()}_`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Telegram /recommend error:', err);
    await ctx.reply('❌ Error generating recommendation.');
  }
}

/** /alerts — manage notification preferences */
export async function handleAlerts(ctx: Context, supabase: SupabaseClient): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getTelegramUserByChatId(supabase, chatId);
  if (!user) {
    await ctx.reply('Please use /start first to register.');
    return;
  }

  if (!user.api_key_id) {
    await ctx.reply(
      '⚠️ Account not linked. Link your WhichModel account to manage alerts.\n' +
      '_Generate a link token from the WhichModel dashboard._',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Ensure default prefs exist
  await initDefaultPrefs(supabase, user.id);
  const prefs = await getNotificationPrefs(supabase, user.id);

  await ctx.reply(
    '*Alert Preferences*\nTap to toggle notifications:',
    { parse_mode: 'Markdown', reply_markup: alertsKeyboard(prefs) },
  );
}

/** /changes — recent price changes */
export async function handleChanges(ctx: Context, supabase: SupabaseClient): Promise<void> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const changes = await getPriceChangesSince(supabase, since);

    if (changes.length === 0) {
      await ctx.reply('No price changes in the last 24 hours.');
      return;
    }

    let msg = `*Price Changes (last 24h)*\n\n`;
    const shown = changes.slice(0, 15);

    for (const c of shown) {
      const icon = c.change_type === 'new_model' ? '🆕' :
                   c.change_type === 'price_decrease' ? '📉' :
                   c.change_type === 'price_increase' ? '📈' : '⚠️';
      msg += `${icon} *${c.model_id}*\n`;
      msg += `  ${c.note}\n\n`;
    }

    if (changes.length > 15) {
      msg += `_...and ${changes.length - 15} more changes_`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Telegram /changes error:', err);
    await ctx.reply('❌ Error fetching price changes.');
  }
}

/** Handle inline keyboard callback queries */
export async function handleCallbackQuery(ctx: Context, supabase: SupabaseClient): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Toggle notification pref
  if (data.startsWith('toggle:')) {
    const eventType = data.slice(7) as NotificationEventType;
    if (!ALL_EVENT_TYPES.includes(eventType)) {
      await ctx.answerCallbackQuery({ text: 'Unknown event type' });
      return;
    }

    const user = await getTelegramUserByChatId(supabase, chatId);
    if (!user) {
      await ctx.answerCallbackQuery({ text: 'Please /start first' });
      return;
    }

    const prefs = await getNotificationPrefs(supabase, user.id);
    const currentPref = prefs.find((p) => p.event_type === eventType);
    const newEnabled = !(currentPref?.enabled ?? true);

    await toggleNotificationPref(supabase, user.id, eventType, newEnabled);

    // Refresh prefs and update keyboard
    const updatedPrefs = await getNotificationPrefs(supabase, user.id);
    await ctx.editMessageReplyMarkup({ reply_markup: alertsKeyboard(updatedPrefs) });
    await ctx.answerCallbackQuery({
      text: `${EVENT_TYPE_LABELS[eventType]}: ${newEnabled ? 'ON' : 'OFF'}`,
    });
    return;
  }

  if (data === 'alerts:done') {
    await ctx.editMessageText('✅ Alert preferences saved.');
    await ctx.answerCallbackQuery();
    return;
  }

  // Notification actions
  if (data.startsWith('ack:')) {
    await ctx.answerCallbackQuery({ text: 'Acknowledged!' });
    return;
  }

  if (data.startsWith('snooze:')) {
    await ctx.answerCallbackQuery({ text: 'Snoozed for 1 hour' });
    return;
  }

  if (data.startsWith('details:')) {
    await ctx.answerCallbackQuery({ text: 'Visit whichmodel.dev for full details' });
    return;
  }

  await ctx.answerCallbackQuery();
}
