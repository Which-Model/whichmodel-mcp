/** Telegram bot types */

export interface TelegramUser {
  id: number;
  telegram_chat_id: number;
  telegram_username: string | null;
  api_key_id: number | null;
  linked_at: string;
  created_at: string;
  updated_at: string;
}

export interface TelegramLinkToken {
  id: number;
  token: string;
  api_key_id: number;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface TelegramNotificationPref {
  id: number;
  telegram_user_id: number;
  event_type: NotificationEventType;
  enabled: boolean;
  min_change_pct: number | null;
  providers: string[] | null;
  created_at: string;
  updated_at: string;
}

export type NotificationEventType =
  | 'price_change'
  | 'new_model'
  | 'deprecation'
  | 'capability_failure';

export const ALL_EVENT_TYPES: NotificationEventType[] = [
  'price_change',
  'new_model',
  'deprecation',
  'capability_failure',
];

export const EVENT_TYPE_LABELS: Record<NotificationEventType, string> = {
  price_change: 'Price Changes',
  new_model: 'New Models',
  deprecation: 'Model Deprecations',
  capability_failure: 'Capability Test Failures',
};
