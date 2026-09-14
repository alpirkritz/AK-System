/** Partition watched groups into opt-in label clusters vs per-group singles. */

export interface SummaryGroupRef {
  jid: string
  name: string
}

export interface SummaryCluster {
  labelId: string
  labelName: string
  groups: SummaryGroupRef[]
}

export interface PartitionedSummaries {
  clusters: SummaryCluster[]
  singles: SummaryGroupRef[]
}

export interface DueSummaryRow {
  enabled: boolean
  jid: string
  name: string
  groupTimes: string[]
  labelId: string | null
  labelName: string | null
  labelTimes: string[]
  aggregateSummaries: boolean
}

export function effectiveSummaryTimes(groupTimes: string[], labelTimes: string[]): string[] {
  return groupTimes.length > 0 ? groupTimes : labelTimes
}

/** `slot === null` means on-demand: every enabled group is treated as due. */
export function partitionDueSummaries(
  rows: DueSummaryRow[],
  slot: string | null,
): PartitionedSummaries {
  const due = rows.filter((row) => {
    if (!row.enabled) return false
    if (slot === null) return true
    return effectiveSummaryTimes(row.groupTimes, row.labelTimes).includes(slot)
  })

  const clustered = new Map<string, SummaryCluster>()
  const singles: SummaryGroupRef[] = []

  for (const row of due) {
    const ref: SummaryGroupRef = { jid: row.jid, name: row.name }
    const canCluster = Boolean(row.aggregateSummaries && row.labelId && row.labelName)
    if (!canCluster || !row.labelId || !row.labelName) {
      singles.push(ref)
      continue
    }
    const existing = clustered.get(row.labelId)
    if (existing) {
      existing.groups.push(ref)
    } else {
      clustered.set(row.labelId, {
        labelId: row.labelId,
        labelName: row.labelName,
        groups: [ref],
      })
    }
  }

  const clusters: SummaryCluster[] = []
  for (const cluster of clustered.values()) {
    if (cluster.groups.length >= 2) {
      clusters.push(cluster)
    } else {
      singles.push(...cluster.groups)
    }
  }

  clusters.sort((a, b) => a.labelName.localeCompare(b.labelName, 'he'))
  return { clusters, singles }
}

export function formatClusterSummaryMessage(clusterName: string, body: string): string {
  const header = `📋 סיכום — ${clusterName}\n\n`
  return (header + body).slice(0, 65000)
}
