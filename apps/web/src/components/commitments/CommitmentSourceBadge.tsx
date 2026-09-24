const LABELS: Record<string, string> = {
  meeting_analysis: 'Notion',
  whatsapp_dm: 'WhatsApp',
  whatsapp_group: 'WhatsApp',
  email: 'Email',
  voice: 'הקלטה',
}

export function commitmentSourceLabel(source: string): string {
  return LABELS[source] ?? source
}

export function CommitmentSourceBadge({ source }: { source: string }) {
  return (
    <span className="pill text-[10px] py-0 shrink-0" data-testid="commitment-source">
      {commitmentSourceLabel(source)}
    </span>
  )
}
