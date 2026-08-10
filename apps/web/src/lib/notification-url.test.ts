import { describe, expect, it } from 'vitest'
import {
  chatMessageIdFromUrl,
  isNavigableNotificationUrl,
  notificationPreview,
  withChatMessageId,
} from './notification-url'

describe('isNavigableNotificationUrl', () => {
  it('rejects empty and notifications inbox', () => {
    expect(isNavigableNotificationUrl('')).toBe(false)
    expect(isNavigableNotificationUrl('   ')).toBe(false)
    expect(isNavigableNotificationUrl('/notifications')).toBe(false)
    expect(isNavigableNotificationUrl('/notifications/')).toBe(false)
    expect(isNavigableNotificationUrl('/notifications?x=1')).toBe(false)
  })

  it('accepts real app paths', () => {
    expect(isNavigableNotificationUrl('/chat')).toBe(true)
    expect(isNavigableNotificationUrl('/agents?id=1')).toBe(true)
    expect(isNavigableNotificationUrl('/tasks')).toBe(true)
    expect(isNavigableNotificationUrl('/chat?message=msg_1')).toBe(true)
  })
})

describe('notificationPreview', () => {
  it('collapses newlines so two clamped lines carry content', () => {
    const body = '🤖 Meeting Prep Herald\n\n# Pre-meeting brief\n\n## Bottom line\n* פריט ראשון'
    expect(notificationPreview(body)).toBe(
      '🤖 Meeting Prep Herald · Pre-meeting brief · Bottom line · פריט ראשון',
    )
  })

  it('strips markdown markers that read as noise when flattened', () => {
    expect(notificationPreview('### כותרת\n- פריט\n1. שלב\n> ציטוט\n**מודגש**')).toBe(
      'כותרת · פריט · שלב · ציטוט · מודגש',
    )
  })

  it('trims surrounding whitespace', () => {
    expect(notificationPreview('  \n שלום עולם \n ')).toBe('שלום עולם')
  })

  it('caps very long bodies so the row never renders a whole brief', () => {
    const preview = notificationPreview('א'.repeat(1000))
    expect(preview.length).toBe(300)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('leaves short bodies untouched', () => {
    expect(notificationPreview('קצר')).toBe('קצר')
    expect(notificationPreview('קצר')).not.toContain('…')
  })
})

describe('withChatMessageId', () => {
  it('adds the message id to a bare chat link', () => {
    expect(withChatMessageId('/chat', 'msg_42')).toBe('/chat?message=msg_42')
  })

  it('preserves existing query params', () => {
    expect(withChatMessageId('/chat?tab=all', 'msg_42')).toBe('/chat?tab=all&message=msg_42')
  })

  it('does not override an explicit message id', () => {
    expect(withChatMessageId('/chat?message=already', 'msg_42')).toBe('/chat?message=already')
  })

  it('leaves non-chat destinations alone', () => {
    expect(withChatMessageId('/settings/whatsapp', 'msg_42')).toBe('/settings/whatsapp')
    expect(withChatMessageId('/agents?agent=07', 'msg_42')).toBe('/agents?agent=07')
  })

  it('tolerates a trailing slash on the chat path', () => {
    expect(withChatMessageId('/chat/', 'msg_42')).toBe('/chat?message=msg_42')
  })
})

describe('chatMessageIdFromUrl', () => {
  it('reads the id when present', () => {
    expect(chatMessageIdFromUrl('/chat?message=msg_7')).toBe('msg_7')
    expect(chatMessageIdFromUrl('/chat?tab=all&message=msg_7')).toBe('msg_7')
  })

  it('returns null when absent or blank', () => {
    expect(chatMessageIdFromUrl('/chat')).toBeNull()
    expect(chatMessageIdFromUrl('/chat?tab=all')).toBeNull()
    expect(chatMessageIdFromUrl('/chat?message=')).toBeNull()
  })
})
