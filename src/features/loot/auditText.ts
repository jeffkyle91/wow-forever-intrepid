import type { AuditEntry } from '../../shared/game/lootAudit.ts'

// The Log in words: one line for what happened, then what changed. Pure, so Node tests it; the dialog only lays it out.

const fieldLabels: Record<string, string> = {
  currentPhase: 'Current phase', nextPhase: 'Next phase', phaseHistory: 'Finished phases',
  item: 'Item', encounter: 'Dungeon and boss', rankedPlayers: 'Candidates', councilNote: 'Council note', itemId: 'Item id', zoneId: 'Dungeon id',
  npcId: 'Creature id', phaseNo: 'Phase', carriedFrom: 'Carried over from', priorityId: 'Priority', recipient: 'Recipient', recipientId: 'Recipient id',
  awardedAt: 'Award date', awardNote: 'Award note', prioritySnapshot: 'Candidates at the time', councilNoteSnapshot: 'Council note at the time',
  decision: 'Decision', status: 'Status', removedReason: 'Reason for removal',
  key: 'Creature key', name: 'Name', kind: 'Kind', players: 'Players', order: 'Place in the order', itemIds: 'Items', hiddenItemIds: 'Hidden items', removed: 'Removed',
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
// What the Log can look up for a drop list entry: the name of a zone by its number, of a creature by its zone and key (an entry about a document that
// sets no name has none), of an item by its number (when it is known by now), and the phase a custom zone or a creature was first written in (its
// first document is "added", the ones after it are changes to it).
export type TableLookups = {
  zoneName?: (zoneId: number) => string | undefined
  sourceName?: (zoneId: number, key: string) => string | undefined
  itemName?: (itemId: number) => string | undefined
  firstZonePhase?: (zoneId: number) => number | undefined
  firstSourcePhase?: (zoneId: number, key: string) => number | undefined
}

const numbers = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : [])
const count = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`
const CUSTOM_ZONE_MIN = 50_000_000 // the same number as shared/game/guildTables.ts (no imports here, so Node runs this file's tests directly)

// An entry about the guild's own drop lists (a zone, or a creature of any zone) in one phase. The target id says which, and which phase: z{zone}_{phase}
// or s{zone}_{key}_{phase}. A document means "from this phase on", so the title says the phase. A document says only what its phase changes, so
// every name, kind, place, number or size it carries is a deliberate change and is always listed.
function describeTableEntry(entry: AuditEntry, lookups: TableLookups, phaseName: (no: number) => string, change: (field: string) => string): EntryText {
  const parts = entry.targetId.split('_')
  const isZone = entry.targetId.startsWith('z')
  const zoneNo = Number(parts[0].slice(1))
  const key = isZone ? '' : parts.slice(1, -1).join('_')
  const phaseNo = Number(parts[parts.length - 1])
  const when = Number.isInteger(phaseNo) ? ` (${phaseName(phaseNo)})` : ''
  const zone = quote(lookups.zoneName?.(zoneNo) ?? 'a zone')
  const called = entry.item || (isZone ? lookups.zoneName?.(zoneNo) : lookups.sourceName?.(zoneNo, key)) || ''
  const item = quote(called || (isZone ? 'a zone' : 'a creature'))
  const itemLabel = (id: number) => { const name = lookups.itemName?.(id); return name ? `${name} (${id})` : String(id) }
  const ids = (list: number[]) => clip(list.map(itemLabel).join(', '))
  const result = (title: string, details: string[]): EntryText => ({ title: `${title}${when}`, details })
  const shown = (field: string) => `${label(field)}: ${showValue(field, entry.after[field], (no) => String(no))}`
  const removedNow = typeof entry.after.removed === 'boolean' ? entry.after.removed : undefined
  // The attributes this document sets: shown as they are on a new document, as before and after on a change.
  const attributes = (fields: string[]) => fields.filter((field) => entry.changed.includes(field)).map((field) => (entry.action === 'create' ? shown(field) : change(field)))

  if (isZone) {
    const introduced = zoneNo >= CUSTOM_ZONE_MIN && entry.action === 'create' && lookups.firstZonePhase?.(zoneNo) === phaseNo
    const details = attributes(['name', 'kind', 'players'])
    if (introduced) return result(`Added the zone ${item}`, attributes(['kind', 'players']))
    if (removedNow === true) return result(`Took the zone ${item} out of the lists from here on`, details)
    if (removedNow === false) return result(`Put the zone ${item} back in the lists`, details)
    if (entry.changed.includes('removed')) return result(`Made ${item} follow the earlier phase again`, details) // `removed` was taken away
    return result(`Changed the zone ${item}`, details)
  }

  // A creature or the zone-wide list. Its first document is the creature being added; a later one is a change from that phase on.
  const introduced = entry.action === 'create' && !key.startsWith('npc') && key !== 'zonewide' && lookups.firstSourcePhase?.(zoneNo, key) === phaseNo
  if (introduced) {
    const lines = attributes(['kind', 'npcId'])
    const given = numbers(entry.after.itemIds)
    if (given.length) lines.push(`Items: ${ids(given)}`)
    return result(`Added ${item} to ${zone}`, lines)
  }
  const before = numbers(entry.before.itemIds)
  const after = numbers(entry.after.itemIds)
  const hiddenBefore = numbers(entry.before.hiddenItemIds)
  const hiddenAfter = numbers(entry.after.hiddenItemIds)
  const added = after.filter((id) => !before.includes(id))
  const taken = [...before.filter((id) => !after.includes(id)), ...hiddenAfter.filter((id) => !hiddenBefore.includes(id))]
  const back = hiddenBefore.filter((id) => !hiddenAfter.includes(id))
  const details = [
    ...(added.length ? [`Added: ${ids(added)}`] : []),
    ...(taken.length ? [`Taken off from here on: ${ids(taken)}`] : []),
    ...(back.length ? [`Brought back: ${ids(back)}`] : []),
    ...attributes(['name', 'kind', 'order', 'npcId']),
  ]
  if (removedNow === true) return result(`Took ${item} out of ${zone} from here on`, details)
  if (removedNow === false) return result(`Put ${item} back in ${zone}`, details)
  if (entry.changed.includes('removed')) return result(`Made ${item} in ${zone} follow the earlier phase again`, details) // `removed` was taken away
  const title = added.length ? `Added ${count(added.length)} to ${item} in ${zone}`
    : taken.length ? `Took ${count(taken.length)} off ${item} in ${zone}`
      : back.length ? `Brought back ${count(back.length)} of ${item} in ${zone}`
        : `Changed ${item} in ${zone}`
  return result(title, details)
}

export function describeEntry(entry: AuditEntry, phaseName: (no: number) => string, lookups: TableLookups = {}): EntryText {
  const item = quote(entry.item)
  const change = (field: string) => `${label(field)}: ${showValue(field, entry.before[field], phaseName)} \u2192 ${showValue(field, entry.after[field], phaseName)}`
  const listed = (values: Record<string, unknown>) => entry.changed.map((field) => `${label(field)}: ${showValue(field, values[field], phaseName)}`)
  const reason = entry.reason ? [`Reason: ${clip(entry.reason)}`] : []

  if (entry.targetType === 'table') return describeTableEntry(entry, lookups, phaseName, change)
  if (entry.targetType === 'phase') {
    // A phase was started or reopened: the history gained or lost its last name, and the current phase changed.
    const history = (values: Record<string, unknown>) => (Array.isArray(values.phaseHistory) ? values.phaseHistory.map(String) : [])
    const now = typeof entry.after.currentPhase === 'string' ? entry.after.currentPhase : entry.item
    const closed = history(entry.after).at(-1)
    const left = typeof entry.before.currentPhase === 'string' ? entry.before.currentPhase : ''
    if (entry.action === 'reopen') return { title: `Reopened ${quote(now)}`, details: [left ? `${quote(left)} is the next phase again` : 'The phase being left is the next phase again', ...entry.changed.map(change)] }
    return { title: `Started ${quote(now)}`, details: [closed ? `${quote(closed)} is closed and read-only` : 'The previous phase is closed and read-only', ...entry.changed.map(change)] }
  }
  if (entry.targetType === 'priority') {
    switch (entry.action) {
      case 'create': return { title: `Added ${item} to the list`, details: listed(entry.after) }
      case 'delete': return { title: `Removed ${item} from the list`, details: listed(entry.before) }
      case 'reorder': return { title: `Reordered the candidates for ${item}`, details: [`Before: ${showValue('rankedPlayers', entry.before.rankedPlayers, phaseName)}`, `After: ${showValue('rankedPlayers', entry.after.rankedPlayers, phaseName)}`, ...reason] }
      default: {
        // A priority taken off the list is kept (hidden), and put back by taking the field away: say so, not "hidden: (none) to true".
        if (entry.changed.includes('hidden')) {
          const off = entry.after.hidden === true
          return { title: off ? `Took ${item} off the list (its priorities are kept)` : `Put ${item} back on the list`, details: [...entry.changed.filter((field) => field !== 'hidden').map(change), ...reason] }
        }
        return { title: `Changed ${item}`, details: [...entry.changed.map(change), ...reason] }
      }
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
