import type { SupabaseClient } from '@supabase/supabase-js';
import type { TelegramUser, TelegramLinkToken, TelegramNotificationPref, NotificationEventType } from './types.js';
import { ALL_EVENT_TYPES } from './types.js';

// ── User management ──

export async function getTelegramUserByChatId(
  supabase: SupabaseClient,
  chatId: number,
): Promise<TelegramUser | null> {
  const { data, error } = await supabase
    .from('telegram_users')
    .select('*')
    .eq('telegram_chat_id', chatId)
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to get telegram user: ${error.message}`);
  return data as TelegramUser;
}

export async function createTelegramUser(
  supabase: SupabaseClient,
  chatId: number,
  username: string | undefined,
): Promise<TelegramUser> {
  const { data, error } = await supabase
    .from('telegram_users')
    .upsert(
      { telegram_chat_id: chatId, telegram_username: username ?? null },
      { onConflict: 'telegram_chat_id' },
    )
    .select()
    .single();
  if (error) throw new Error(`Failed to create telegram user: ${error.message}`);
  return data as TelegramUser;
}

export async function linkTelegramUserToApiKey(
  supabase: SupabaseClient,
  telegramUserId: number,
  apiKeyId: number,
): Promise<void> {
  const { error } = await supabase
    .from('telegram_users')
    .update({ api_key_id: apiKeyId, linked_at: new Date().toISOString() })
    .eq('id', telegramUserId);
  if (error) throw new Error(`Failed to link telegram user: ${error.message}`);
}

// ── Link tokens ──

export async function createLinkToken(
  supabase: SupabaseClient,
  apiKeyId: number,
  token: string,
  expiresInMinutes: number = 15,
): Promise<TelegramLinkToken> {
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('telegram_link_tokens')
    .insert({ token, api_key_id: apiKeyId, expires_at: expiresAt })
    .select()
    .single();
  if (error) throw new Error(`Failed to create link token: ${error.message}`);
  return data as TelegramLinkToken;
}

export async function consumeLinkToken(
  supabase: SupabaseClient,
  token: string,
): Promise<TelegramLinkToken | null> {
  const { data, error } = await supabase
    .from('telegram_link_tokens')
    .select('*')
    .eq('token', token)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to consume link token: ${error.message}`);
  if (!data) return null;

  // Mark as used
  await supabase
    .from('telegram_link_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', data.id);

  return data as TelegramLinkToken;
}

// ── Notification preferences ──

export async function getNotificationPrefs(
  supabase: SupabaseClient,
  telegramUserId: number,
): Promise<TelegramNotificationPref[]> {
  const { data, error } = await supabase
    .from('telegram_notification_prefs')
    .select('*')
    .eq('telegram_user_id', telegramUserId);
  if (error) throw new Error(`Failed to get notification prefs: ${error.message}`);
  return (data ?? []) as TelegramNotificationPref[];
}

export async function initDefaultPrefs(
  supabase: SupabaseClient,
  telegramUserId: number,
): Promise<void> {
  const rows = ALL_EVENT_TYPES.map((eventType) => ({
    telegram_user_id: telegramUserId,
    event_type: eventType,
    enabled: true,
    min_change_pct: eventType === 'price_change' ? 5.0 : null,
  }));
  const { error } = await supabase
    .from('telegram_notification_prefs')
    .upsert(rows, { onConflict: 'telegram_user_id,event_type' });
  if (error) throw new Error(`Failed to init default prefs: ${error.message}`);
}

export async function toggleNotificationPref(
  supabase: SupabaseClient,
  telegramUserId: number,
  eventType: NotificationEventType,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('telegram_notification_prefs')
    .upsert(
      { telegram_user_id: telegramUserId, event_type: eventType, enabled },
      { onConflict: 'telegram_user_id,event_type' },
    );
  if (error) throw new Error(`Failed to toggle notification pref: ${error.message}`);
}

// ── Subscribers for notifications ──

export async function getSubscribersForEvent(
  supabase: SupabaseClient,
  eventType: NotificationEventType,
): Promise<Array<{ telegram_chat_id: number; min_change_pct: number | null; providers: string[] | null }>> {
  const { data, error } = await supabase
    .from('telegram_notification_prefs')
    .select('telegram_user_id, min_change_pct, providers, telegram_users!inner(telegram_chat_id)')
    .eq('event_type', eventType)
    .eq('enabled', true);
  if (error) throw new Error(`Failed to get subscribers: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    telegram_chat_id: (row.telegram_users as Record<string, unknown>).telegram_chat_id as number,
    min_change_pct: row.min_change_pct as number | null,
    providers: row.providers as string[] | null,
  }));
}
