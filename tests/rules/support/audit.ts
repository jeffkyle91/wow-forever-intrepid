// Builders shared by the audit log tests: one batch that edits (or creates, or deletes) an award or a priority
// together with an audit entry for it. Everything is honest unless a test overrides a field, so a test can break
// exactly one thing and see what the rules do. See audit.test.ts and audit-details.test.ts.
import { serverTimestamp, writeBatch, type DocumentData, type Firestore } from 'firebase/firestore'
import { PLAYER_1, PLAYER_2, PLAYER_3, PRIORITY_ID, UID, awardDoc, displayNameOf, priorityDoc, rosterDoc } from './fixtures.ts'
import { guildDoc, stored } from './harness.ts'

export const AWARD = 'award-1' // seeded without any of the new fields, like every award written before this change
export type Staff = 'raidLeader' | 'guildLeader'
export type TargetType = 'award' | 'priority'

/** Firestore refuses `undefined`, so a field a test wants missing is passed as undefined and dropped here. */
export const clean = (data: DocumentData): DocumentData => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))

export const entryId = (type: TargetType, id: string, rev: number) => `${type}_${id}_${rev}`

/** What an honest entry says about a change: the fields, with the values the stored document has and will have. */
export function describeChange(current: DocumentData | undefined, changes: DocumentData): DocumentData {
  const keys = Object.keys(changes)
  return { changed: keys, before: Object.fromEntries(keys.map((key) => [key, current?.[key] ?? null])), after: changes }
}

/** An audit entry as `who` would write it. Everything is valid unless a test overrides a field. */
export function entry(who: Staff, type: TargetType, id: string, rev: number, overrides: DocumentData = {}): DocumentData {
  return { at: serverTimestamp(), by: UID[who], byName: displayNameOf(UID[who]), targetType: type, targetId: id, rev, action: 'edit', item: 'Test Sword', changed: [], ...overrides }
}

/** What an award edit has to carry besides the changed fields. */
export const stamp = (who: Staff, rev: number): DocumentData => ({ rev, updatedBy: UID[who], updatedAt: serverTimestamp() })

/** An entry that says nothing changed, for edits that touch only stamp fields (createdBy, createdAt) the log does not list. */
export const NOTHING = { changed: [], before: {}, after: {} }

export type EditOptions = {
  awardId?: string
  rev?: number
  changes?: DocumentData
  award?: DocumentData // overrides for the award update
  audit?: DocumentData // overrides for the entry
  skipEntry?: boolean
  skipAward?: boolean
  entryKey?: string
  extraEntries?: [string, DocumentData][]
}

/** One batch: the award edit plus an honest entry for it. Either part can be changed or left out. */
export async function editAward(
  db: Firestore,
  who: Staff,
  { awardId = AWARD, rev = 1, changes = { recipient: PLAYER_3 }, award = {}, audit = {}, skipEntry = false, skipAward = false, entryKey, extraEntries = [] }: EditOptions = {},
) {
  const current = await stored(`awards/${awardId}`)
  const batch = writeBatch(db)
  if (!skipAward) batch.update(guildDoc(db, `awards/${awardId}`), clean({ ...changes, ...stamp(who, rev), ...award }))
  if (!skipEntry) {
    const data = entry(who, 'award', awardId, rev, { item: current?.item, ...describeChange(current, changes), ...audit })
    batch.set(guildDoc(db, `auditLog/${entryKey ?? entryId('award', awardId, rev)}`), clean(data))
  }
  for (const [id, data] of extraEntries) batch.set(guildDoc(db, `auditLog/${id}`), clean(data))
  return batch.commit()
}

/** Create an award at revision 1 with its create entry. */
export function createAward(
  db: Firestore,
  who: Staff,
  { id = 'award-new', fields = awardDoc(), award = {}, audit = {}, entryKey }: { id?: string; fields?: DocumentData; award?: DocumentData; audit?: DocumentData; entryKey?: string } = {},
) {
  const batch = writeBatch(db)
  batch.set(guildDoc(db, `awards/${id}`), clean({ ...fields, rev: 1, createdBy: UID[who], createdAt: serverTimestamp(), updatedBy: UID[who], updatedAt: serverTimestamp(), ...award }))
  batch.set(guildDoc(db, `auditLog/${entryKey ?? entryId('award', id, 1)}`), clean(entry(who, 'award', id, 1, { action: 'create', item: fields.item, ...describeChange(undefined, fields), ...audit })))
  return batch.commit()
}

export const MANUAL = 'award-manual'

/** A manual award (no priority): the seeded roster character PLAYER_2, decided by a roll. Valid unless a test overrides a field. */
export const manualAwardDoc = (overrides: DocumentData = {}): DocumentData => ({
  item: 'Test Sword', encounter: 'Test Boss', recipient: rosterDoc(2).name, recipientId: PLAYER_2, awardedAt: '2026-12-09', awardNote: '', decision: 'roll', phaseNo: 0, ...overrides,
})

/** Create a manual award at revision 1 with its create entry. Honest unless a test overrides a part, or leaves the entry out. */
export function createManualAward(
  db: Firestore,
  who: Staff,
  { id = MANUAL, fields = manualAwardDoc(), award = {}, audit = {}, entryKey, skipEntry = false }: { id?: string; fields?: DocumentData; award?: DocumentData; audit?: DocumentData; entryKey?: string; skipEntry?: boolean } = {},
) {
  const batch = writeBatch(db)
  batch.set(guildDoc(db, `awards/${id}`), clean({ ...fields, rev: 1, createdBy: UID[who], createdAt: serverTimestamp(), ...award }))
  if (!skipEntry) batch.set(guildDoc(db, `auditLog/${entryKey ?? entryId('award', id, 1)}`), clean(entry(who, 'award', id, 1, { action: 'create', item: fields.item, ...describeChange(undefined, fields), ...audit })))
  return batch.commit()
}

/** Update a priority and file an entry for it. Priorities are not forced to carry an entry in this stage, but an entry has to be truthful. */
export async function editPriority(
  db: Firestore,
  who: Staff,
  { id = PRIORITY_ID, rev = 1, changes = { councilNote: 'Rewritten note' }, priority = {}, audit = {}, entryKey, action = 'edit' }: { id?: string; rev?: number; changes?: DocumentData; priority?: DocumentData; audit?: DocumentData; entryKey?: string; action?: string } = {},
) {
  const current = await stored(`lootPriorities/${id}`)
  const batch = writeBatch(db)
  batch.update(guildDoc(db, `lootPriorities/${id}`), clean({ ...changes, rev, ...priority }))
  batch.set(guildDoc(db, `auditLog/${entryKey ?? entryId('priority', id, rev)}`), clean(entry(who, 'priority', id, rev, { action, item: current?.item, ...describeChange(current, changes), ...audit })))
  return batch.commit()
}

/** Reorder a priority and log it as a reorder. */
export const reorderPriority = (db: Firestore, who: Staff, { order = [PLAYER_3, PLAYER_2, PLAYER_1], ...rest }: { id?: string; rev?: number; audit?: DocumentData; entryKey?: string; order?: string[] } = {}) =>
  editPriority(db, who, { ...rest, changes: { rankedPlayers: order }, action: 'reorder' })

/** Create a priority at revision 1 with its create entry (honest unless overridden). */
export function createPriority(db: Firestore, who: Staff, { id = 'priority-2', fields = priorityDoc(), audit = {}, entryKey }: { id?: string; fields?: DocumentData; audit?: DocumentData; entryKey?: string } = {}) {
  const batch = writeBatch(db)
  batch.set(guildDoc(db, `lootPriorities/${id}`), { ...fields, rev: 1, updatedBy: UID[who], updatedAt: serverTimestamp() })
  batch.set(guildDoc(db, `auditLog/${entryKey ?? entryId('priority', id, 1)}`), clean(entry(who, 'priority', id, 1, { action: 'create', item: fields.item, ...describeChange(undefined, fields), ...audit })))
  return batch.commit()
}
/** Delete the seeded priority and file a delete entry (honest unless overridden). */
export async function deletePriority(db: Firestore, who: Staff, { rev = 1, audit = {} }: { rev?: number; audit?: DocumentData } = {}) {
  const current = await stored(`lootPriorities/${PRIORITY_ID}`)
  const batch = writeBatch(db)
  batch.delete(guildDoc(db, `lootPriorities/${PRIORITY_ID}`))
  batch.set(guildDoc(db, `auditLog/${entryId('priority', PRIORITY_ID, rev)}`), clean(entry(who, 'priority', PRIORITY_ID, rev, { action: 'delete', item: current?.item, changed: Object.keys(current ?? {}), before: current, ...audit })))
  return batch.commit()
}

export const stampedAward = (overrides: DocumentData = {}) =>
  awardDoc({ rev: 3, createdBy: UID.raidLeader, createdAt: new Date('2026-12-09T20:00:00Z'), updatedBy: UID.raidLeader, updatedAt: new Date('2026-12-09T21:00:00Z'), ...overrides })
export const removedAward = (overrides: DocumentData = {}) => awardDoc({ rev: 1, status: 'removed', removedReason: 'Entered by mistake', ...overrides })

export { priorityDoc }
