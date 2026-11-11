-- Fix WhatsApp summaries: move רום and עומרי from individual 20:00 summaries
-- to the unified daily digest at 20:30

-- Clear individual summary times for all groups (they'll use the daily digest instead)
UPDATE whatsapp_groups 
SET summary_times = '[]', 
    updated_at = datetime('now')
WHERE summary_times IS NOT NULL 
  AND summary_times != '[]';

-- Ensure daily digest is enabled at 20:30
INSERT OR REPLACE INTO notification_preferences (
  type_id, 
  enabled, 
  schedule_times, 
  channel_whatsapp, 
  channel_push, 
  channel_telegram, 
  updated_at
)
VALUES (
  'whatsapp_daily_digest', 
  1, 
  '["20:30"]', 
  1, 
  1, 
  1, 
  datetime('now')
);

-- Verify the changes
SELECT 'Groups with individual summaries (should be empty):' as check;
SELECT jid, name, summary_times 
FROM whatsapp_groups 
WHERE summary_times IS NOT NULL 
  AND summary_times != '[]';

SELECT 'Daily digest config:' as check;
SELECT type_id, enabled, schedule_times, last_sent_at 
FROM notification_preferences 
WHERE type_id = 'whatsapp_daily_digest';
