import type { AnalysisResult } from './meeting-analysis'

/** The analysis text saved on the meeting, also sent to Alpir's WhatsApp. */
export function formatAnalysisMessage(
  analysis: AnalysisResult,
  meetingTitle: string,
  meetingDate: string,
): string {
  const participantsText = analysis.participants
    .map((p) => (p.confirmed ? p.name : `${p.name} (unconfirmed)`))
    .join(', ')

  const actionItemsText =
    analysis.actionItems.length > 0
      ? analysis.actionItems
          .map((item) => {
            const ownerText = item.owner ? ` (${item.owner})` : ''
            return `• ${item.content}${ownerText}`
          })
          .join('\n')
      : '(לא זוהו אקשן אייטמס)'

  return `✅ *ההקלטה נותחה!*

📅 *פגישה:* ${meetingTitle}
📆 *תאריך:* ${meetingDate}
👥 *משתתפים:* ${participantsText}

🧠 הכובע שנבחר: ${analysis.hatName}

📌 נושא השיחה: ${analysis.topic}

🎭 אווירה: ${analysis.mood}

🕵️ הסאב-טקסט: ${analysis.subtext}

💡 תובנה מרכזית: ${analysis.keyInsight}

⚖️ מדד: ${analysis.score}/10. ${analysis.scoreRationale}

✅ אקשן אייטמס:
${actionItemsText}

📈 קאיזן - פידבק לצמיחה:
✓ לשימור: ${analysis.kaizenKeep}
→ לשיפור: ${analysis.kaizenImprove}

❓ שאלה למחשבה: ${analysis.openQuestion}`
}
