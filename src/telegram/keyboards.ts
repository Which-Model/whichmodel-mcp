import { InlineKeyboard } from 'grammy';
import type { TelegramNotificationPref } from './types.js';
import { ALL_EVENT_TYPES, EVENT_TYPE_LABELS } from './types.js';

/** Build the alerts management keyboard showing current toggle states. */
export function alertsKeyboard(prefs: TelegramNotificationPref[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  const prefMap = new Map(prefs.map((p) => [p.event_type, p]));

  for (const eventType of ALL_EVENT_TYPES) {
    const pref = prefMap.get(eventType);
    const enabled = pref?.enabled ?? true;
    const icon = enabled ? '✅' : '❌';
    kb.text(`${icon} ${EVENT_TYPE_LABELS[eventType]}`, `toggle:${eventType}`);
    kb.row();
  }

  kb.text('Done', 'alerts:done');
  return kb;
}

/** Quick action buttons for a notification message. */
export function notificationActionsKeyboard(notificationContext: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('👍 Acknowledge', `ack:${notificationContext}`)
    .text('🔕 Snooze 1h', `snooze:${notificationContext}`)
    .row()
    .text('📊 View Details', `details:${notificationContext}`);
}
