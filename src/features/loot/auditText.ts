import type { AuditEntry } from '../../shared/game/lootAudit.ts'

// The change log in words: one line for what happened, then what changed. Pure, so Node tests it; the dialog only lays it out.

const fieldLabels: Record<string, string> = {
  item: 'Item', encounter: 'Dungeon and boss', rankedPlayers: 'Candidates', councilNote: 'Council note', itemId: 'Item id', zoneId: 'Dungeon id',
  npcId: 'Creature id', phaseNo: 'Phase', carriedFrom: 'Carried over from', priorityId: 'Priority', recipient: 'Recipient', recipientId: 'Recipient id',
  awardedAt: 'Award date', awardNote: 'Award note', prioritySnapshot: 'Candidates at the time', councilNoteSnapshot: 'Council note at the time',
  decision: 'Decision', status: 'Status', removedReason: 'Reason for removal',
}

const MAX = 160
const clip = (text: string) => (text.length > MAX ? `${text.slice(0, MAX - 1)}\u2026` : text)

/** A stored value as a person would read it. */
export function showValue(field: string, value: unknown, phaseName: (no: number) => string): string {
  if (value === null || value === undefined) return '(none)'
  if (field === 'phaseNo' && typeof value === 'number') return phaseName(value)
  if (Array.isArray(value)) return value.length ? clip(value.map(String).join(', ')) : '(nobody)'
  if (typeof value === 'string') return value.trim() ? clip(value) : '(empty)'
  return clip(String(value))
}

const label = (field: string) => fieldLabels[field] ?? field
const quote = (item: string) => `\u201c${item || 'Untitled'}\u201d`

export type EntryText = { title: string; details: string[] }

export function describeEntry(entry: AuditEntry, phaseName: (no: number) => string): EntryText {
  const item = quote(entry.item)
  const change = (field: string) => `${label(field)}: ${showValue(field, entry.before[field], phaseName)} \u2192 ${showValue(field, entry.after[field], phaseName)}`
  const listed = (values: Record<string, unknown>) => entry.changed.map((field) => `${label(field)}: ${showValue(field, values[field], phaseName)}`)
  const reason = entry.reason ? [`Reason: ${clip(entry.reason)}`] : []

  if (entry.targetType === 'priority') {
    switch (entry.action) {
      case 'create': return { title: `Added ${item} to the list`, details: listed(entry.after) }
      case 'delete': return { title: `Removed ${item} from the list`, details: listed(entry.before) }
      case 'reorder': return { title: `Reordered the candidates for ${item}`, details: [`Before: ${showValue('rankedPlayers', entry.before.rankedPlayers, phaseName)}`, `After: ${showValue('rankedPlayers', entry.after.rankedPlayers, phaseName)}`, ...reason] }
      default: return { title: `Changed ${item}`, details: [...entry.changed.map(change), ...reason] }
    }
  }
  if (entry.targetType === 'award') {
    switch (entry.action) {
      case 'create': {
        const who = typeof entry.after.recipient === 'string' ? entry.after.recipient : 'someone'
        return { title: `Awarded ${item} to ${who}`, details: listed(entry.after).filter((line) => !/^(Item|Recipient|Priority):/.test(line)) }
      }
      case 'remove': return { title: `Removed the award of ${item}`, details: [...entry.changed.filter((field) => field !== 'status' && field !== 'removedReason').map(change), ...reason] }
      default: return { title: `Corrected the award of ${item}`, details: [...entry.changed.map(change), ...reason] }
    }
  }
  return { title: `${entry.action} ${entry.targetType} ${item}`, details: [...entry.changed.map(change), ...reason] }
}
