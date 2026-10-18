// What the audit log says about loot. Every change to a priority or an award is written together with an entry in the log (see
// docs/design/audit-first-loot.md and the rules in firestore.rules); this file builds what the entry lists and reads an entry back. No
// imports, so Node runs its tests directly. The entry's own rules decide what is accepted: its `changed` list has to be exactly the fields that
// differ, with their old and new values, so these functions must agree with them.

// The fields an entry may list for a priority or an award. The stamps (rev, updatedBy, updatedAt, createdBy, createdAt) are never listed.
export const priorityAuditFields = ['item', 'encounter', 'rankedPlayers', 'rankedIds', 'councilNote', 'itemId', 'zoneId', 'npcId', 'phaseNo', 'carriedFrom', 'hidden'] as const
// The fields an entry may list for a loot table document (a custom zone or a creature; see shared/game/guildTables.ts).
export const tableAuditFields = ['type', 'zoneId', 'key', 'phaseNo', 'name', 'kind', 'players', 'npcId', 'order', 'itemIds', 'hiddenItemIds', 'removed'] as const
// The settings fields a phase entry lists (when a phase is started or reopened): the ones that differ, each with its old and new value.
export const phaseAuditFields = ['currentPhase', 'nextPhase', 'phaseHistory'] as const
export const awardCreateFields = ['priorityId', 'item', 'encounter', 'recipient', 'recipientId', 'awardedAt', 'prioritySnapshot', 'prioritySnapshotIds', 'councilNoteSnapshot', 'awardNote', 'phaseNo'] as const

type Values = Record<string, unknown>

export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameValue(value, b[index]))
  return a === b
}

/** A new document: every field it has is listed, with its value. A field that is undefined is not a field (Firestore refuses one). */
export function describeCreate(fields: Values, listed: readonly string[]) {
  const present = listed.filter((key) => fields[key] !== undefined)
  return { changed: present, after: Object.fromEntries(present.map((key) => [key, fields[key]])) }
}

/**
 * A change to a document: the listed fields whose value differs, with the old and new value. A new value of undefined takes the field away
 * (the entry says null). Nothing differing gives null: there is no change to log.
 */
export function describeEdit(current: Values, changes: Values, listed: readonly string[]) {
  const changed = listed.filter((key) => key in changes && !sameValue(current[key] ?? undefined, changes[key]))
  if (!changed.length) return null
  return {
    changed,
    before: Object.fromEntries(changed.map((key) => [key, current[key] ?? null])),
    after: Object.fromEntries(changed.map((key) => [key, changes[key] ?? null])),
  }
}

/** A deleted document: every listed field it had, with its value. */
export function describeDelete(current: Values, listed: readonly string[]) {
  const present = listed.filter((key) => current[key] !== undefined)
  return { changed: present, before: Object.fromEntries(present.map((key) => [key, current[key]])) }
}

export type AuditTarget = 'award' | 'priority' | 'raid' | 'phase' | 'table'
export type AuditEntry = {
  id: string
  at: Date | null
  by: string
  byName: string
  targetType: string
  targetId: string
  rev: number
  action: string
  item: string
  changed: string[]
  before: Values
  after: Values
  reason: string
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const map = (value: unknown): Values => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Values) : {})

/** An award made before the Log began has no entry; the Log shows it as an entry of its own (revision 0), dated the raid night. */
export function legacyAwardEntry(award: { id: string; priorityId?: string; item: string; encounter: string; recipient: string; awardedAt: string; prioritySnapshot?: string[]; councilNoteSnapshot?: string; awardNote?: string; phaseNo?: number }): AuditEntry {
  const fields: Values = { priorityId: award.priorityId, item: award.item, encounter: award.encounter, recipient: award.recipient, awardedAt: award.awardedAt, prioritySnapshot: award.prioritySnapshot, councilNoteSnapshot: award.councilNoteSnapshot, awardNote: award.awardNote, phaseNo: award.phaseNo }
  const { changed, after } = describeCreate(fields, awardCreateFields)
  const at = new Date(`${award.awardedAt}T12:00:00`)
  return { id: `before-${award.id}`, at: Number.isNaN(at.getTime()) ? null : at, by: '', byName: '', targetType: 'award', targetId: award.id, rev: 0, action: 'create', item: award.item, changed, before: {}, after, reason: '' }
}

/** Reads an entry tolerantly: a missing or odd field becomes empty, an entry with no target is dropped. Never throws. */
export function readAuditEntry(id: string, data: Values): AuditEntry | null {
  if (!id || typeof data.targetType !== 'string' || typeof data.targetId !== 'string') return null
  const stamp = data.at as { toDate?: () => Date } | null | undefined
  const at = stamp && typeof stamp.toDate === 'function' ? stamp.toDate() : null
  return {
    id,
    at: at && !Number.isNaN(at.getTime()) ? at : null,
    by: text(data.by),
    byName: text(data.byName),
    targetType: data.targetType,
    targetId: data.targetId,
    rev: typeof data.rev === 'number' ? data.rev : 0,
    action: text(data.action),
    item: text(data.item),
    changed: Array.isArray(data.changed) ? data.changed.filter((key): key is string => typeof key === 'string') : [],
    before: map(data.before),
    after: map(data.after),
    reason: text(data.reason),
  }
}
