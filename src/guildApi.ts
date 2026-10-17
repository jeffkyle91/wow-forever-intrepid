import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  Timestamp,
  type Firestore,
} from 'firebase/firestore'
import { auth, db, functions, guildId } from './firebase'
import { httpsCallable } from 'firebase/functions'
import type { GuildRole } from './security'
import { nextPhaseRev } from './shared/game/phases'
import { awardCreateFields, describeCreate, describeDelete, describeEdit, phaseAuditFields, priorityAuditFields, readAuditEntry, type AuditEntry } from './shared/game/lootAudit'
import { normalizeDocs, type Normalizer } from './shared/lib/normalize'
import { raidStartDate } from './shared/lib/raidStart'
import { sameRaidZones } from './shared/raids/zoneSnapshots'
import { setMembershipRemoved as writeMembershipRemoved } from './shared/members/access'
import { normalizeCharacterRequest, type CharacterProposal, type CharacterRequest } from './shared/characters/requests'
export type { PlayerRecord } from './shared/game/players'

export type TenManTeam = 'blue' | 'yellow' | 'red' | 'white'
export type RaidGroup = 'green' | 'pink' | 'brown'
// itemId, zoneId and npcId are set when a priority was added from the drop lists (Browse drops): the Wowhead item id, the dungeon
// in data/loot and the creature that drops it. A priority typed by hand has none of them.
// phaseNo is the phase the priority belongs to (see shared/game/phases.ts); none means the first phase. carriedFrom is the id of the
// priority an item was carried over from, in an earlier phase.
export type PriorityRecord = { id: string; item: string; encounter: string; rankedPlayers: string[]; councilNote: string; itemId?: number; zoneId?: number; npcId?: number; phaseNo?: number; carriedFrom?: string; rev?: number; hidden?: true }
export type AwardRecord = {
  id: string
  priorityId: string
  item: string
  encounter: string
  recipient: string
  awardedAt: string
  prioritySnapshot: string[]
  councilNoteSnapshot: string
  awardNote: string
  // The phase the award was recorded in; none means the first phase.
  phaseNo?: number
  // Awards made since the Log began have a revision (1 or more); one without is older and has no entry in the Log.
  rev?: number
}
export type AfkEntryRecord = { id: string; userId: string; displayName: string; startDate: string; endDate: string; createdAt?: unknown }
export type CommentKind = 'public' | 'leadership'
export const COMMENT_MAX_LENGTH = 300
export type RaiderType = 'casual' | 'hardcore'
export type RaidStatus = 'scheduled' | 'cancelled'
export type RaidSize = 10 | 20 | 40
export type RaidZoneRecord = { id: string; name: string; size: RaidSize }
export type RaidRecord = {
  id: string
  date: string
  time?: string
  startsAt?: Timestamp
  name: string
  size: 10 | 20 | 40
  zones?: RaidZoneRecord[]
  description?: string
  createdBy: string
  createdAt?: unknown
  rev?: number
  status?: RaidStatus
  cancelReason?: string
}
export type RaidEdit = Partial<Pick<RaidRecord, 'name' | 'date' | 'time' | 'size' | 'description' | 'zones'>>
export type MembershipRole = GuildRole | 'Removed'
export type MembershipRecord = { id: string; email: string; displayName: string; role: MembershipRole; playerId?: string | null }
export type JoinRequestRecord = { id: string; userId: string; email: string; displayName: string; status: 'pending' | 'approved' | 'rejected' }
export type TeamAssignmentRecord = { id: string; team: TenManTeam }
export type StatusTone = 'active' | 'preparing' | 'paused'
export type CouncilStatus = 'deliberating' | 'live'
export type GuildSettings = {
  currentPhase: string
  nextPhase: string
  currentStatusLabel: string
  currentStatusTone: StatusTone
  nextStatusLabel: string
  nextStatusTone: StatusTone
  councilStatus: CouncilStatus
  teamNames: Record<TenManTeam, string>
  groupNames: Record<RaidGroup, string>
  // The names of the finished phases, oldest first. Its length is the number of the current phase. Absent until a phase has been closed.
  phaseHistory?: string[]
  // How many times a phase has been started or reopened (each one is in the Log). Absent until the first.
  phaseRev?: number
}
export type GuildSettingsRecord = GuildSettings & { id: string }

function requireDb(): Firestore {
  if (!db || !guildId) throw new Error('Firebase is not configured for this guild.')
  return db
}

function guildCollection(name: string) {
  return collection(requireDb(), 'guilds', guildId, name)
}

// `normalize` (see shared/lib/normalize.ts) checks each document's shape and may drop it; without one a
// document is read as `{ ...data, id }`. `dropped` is how many documents in this snapshot were skipped.
export function subscribeGuildCollection<T extends { id: string }>(
  name: string,
  onData: (records: T[], dropped: number) => void,
  onError: (error: Error) => void,
  normalize: Normalizer<T> = (id, data) => ({ ...data, id }) as T,
) {
  return onSnapshot(guildCollection(name), (snapshot) => {
    const { records, droppedIds } = normalizeDocs(snapshot.docs, normalize)
    if (droppedIds.length) console.warn(`${name}: skipped ${droppedIds.length} unreadable document(s), ids: ${droppedIds.join(', ')}`)
    onData(records, droppedIds.length)
  }, onError)
}

export function subscribeCharacterRequests(uid: string, leader: boolean, onData: (records: CharacterRequest[]) => void, onError: (error: Error) => void) {
  const records = guildCollection('characterRequests')
  return onSnapshot(leader ? records : query(records, where('userId', '==', uid)), (snapshot) => {
    const { records, droppedIds } = normalizeDocs(snapshot.docs, normalizeCharacterRequest)
    if (droppedIds.length) {
      console.error(`characterRequests: unreadable document(s): ${droppedIds.join(', ')}`)
      onError(new Error('Some character requests could not be read. Ask a Guild Leader to check the records.'))
    }
    onData(records.sort((a, b) => b.requestedAt.toMillis() - a.requestedAt.toMillis() || a.id.localeCompare(b.id)))
  }, onError)
}

export async function submitCharacterRequest(requestId: string, proposal: CharacterProposal, note: string) {
  if (!functions || !auth?.currentUser) throw new Error('Sign in to request a character change.')
  await httpsCallable(functions, 'submitCharacterRequest')({ guildId, requestId, ...proposal, note })
}

export async function resolveCharacterRequest(requestId: string, action: 'approve' | 'reject' | 'withdraw', note: string) {
  if (!functions || !auth?.currentUser) throw new Error('Sign in to manage character requests.')
  await httpsCallable(functions, 'resolveCharacterRequest')({ guildId, requestId, action, note })
}

export async function getMembership(uid: string) {
  const snapshot = await getDoc(doc(requireDb(), 'guilds', guildId, 'members', uid))
  return snapshot.exists() ? ({ ...snapshot.data(), id: snapshot.id } as MembershipRecord) : null
}

export async function getJoinRequest(uid: string) {
  const snapshot = await getDoc(doc(requireDb(), 'guilds', guildId, 'joinRequests', uid))
  return snapshot.exists() ? ({ ...snapshot.data(), id: snapshot.id } as JoinRequestRecord) : null
}

export async function submitJoinRequest(uid: string, email: string, displayName: string) {
  await setDoc(doc(requireDb(), 'guilds', guildId, 'joinRequests', uid), {
    userId: uid,
    email,
    displayName,
    status: 'pending',
    requestedAt: serverTimestamp(),
  })
}

// A field set to undefined is removed from the stored document (the write merges, so it would otherwise stay). Roster characters only: loot
// priorities and awards are written through the audited helpers below, and the rules refuse any other write to them.
export async function saveGuildRecord(collectionName: 'roster', id: string, data: Record<string, unknown>) {
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === undefined ? deleteField() : value]))
  await setDoc(doc(requireDb(), 'guilds', guildId, collectionName, id), fields, { merge: true })
}

export async function setTeamAssignment(playerId: string, team: TenManTeam | null) {
  const assignmentRef = doc(requireDb(), 'guilds', guildId, 'teamAssignments', playerId)
  if (team) await setDoc(assignmentRef, { team })
  else await deleteDoc(assignmentRef)
}

export async function saveRaidZone(zone: Omit<RaidZoneRecord, 'id'>, id: string = crypto.randomUUID()) {
  await setDoc(doc(requireDb(), 'guilds', guildId, 'raidZones', id), zone)
  return id
}

export async function deleteRaidZone(id: string) {
  await deleteDoc(doc(requireDb(), 'guilds', guildId, 'raidZones', id))
}

export function subscribeRaidZones(onData: (zones: RaidZoneRecord[]) => void, onError: (error: Error) => void) {
  return subscribeGuildCollection<RaidZoneRecord>('raidZones', onData, onError, (id, data) => {
    if (typeof data.name !== 'string' || ![10, 20, 40].includes(data.size as number)) return null
    return { id, name: data.name, size: data.size as RaidSize }
  })
}

// Guild Leaders only: the rules refuse everyone else, and refuse a document that is not exactly this shape.
export async function saveGuildSettings(settings: GuildSettings) {
  await setDoc(doc(requireDb(), 'guilds', guildId, 'settings', 'general'), settings)
}

// Starting a phase or reopening one saves the settings together with its Log entry (`phase_settings_{n}`, n counting every start and reopen),
// which the rules require, so nobody can move the phase without it showing. The entry says what the phase fields were before: what is stored now
// (nothing on a guild's first save, which is why the stored document is read here), not what this browser last showed.
export async function changePhase(next: GuildSettings, action: 'start' | 'reopen', who: AuditWho) {
  const database = requireDb()
  const ref = doc(database, 'guilds', guildId, 'settings', 'general')
  const stored = (await getDoc(ref)).data() ?? {}
  const rev = nextPhaseRev(stored)
  const description = describeEdit(stored, { currentPhase: next.currentPhase, nextPhase: next.nextPhase, phaseHistory: next.phaseHistory }, phaseAuditFields)
  if (!description) throw new Error('Nothing was changed.')
  const batch = writeBatch(database)
  batch.set(ref, { ...next, phaseRev: rev })
  batch.set(doc(database, 'guilds', guildId, 'auditLog', `phase_settings_${rev}`), auditEntry(who, 'phase', 'settings', rev, action, next.currentPhase, description))
  await batch.commit()
}

export async function createAfkEntry(data: Omit<AfkEntryRecord, 'id' | 'createdAt'>) {
  if (!functions || !auth?.currentUser || data.userId !== auth.currentUser.uid) throw new Error('Sign in as the owner to add unavailable dates.')
  await httpsCallable(functions, 'addUnavailableDates')({ guildId, startDate: data.startDate, endDate: data.endDate })
}

export async function deleteAfkEntry(id: string) {
  if (!functions || !auth?.currentUser) throw new Error('Sign in to remove unavailable dates.')
  await httpsCallable(functions, 'removeUnavailableDates')({ guildId, entryId: id })
}

export async function synchronizeRaidAbsences() {
  if (!functions || !auth?.currentUser) throw new Error('Sign in to synchronize raid absences.')
  const result = await httpsCallable<{ guildId: string }, { checkedRaids: number }>(functions, 'synchronizeRaidAbsences', { timeout: 540000 })({ guildId })
  return result.data.checkedRaids
}

const commentCollection = (kind: CommentKind) => (kind === 'public' ? 'publicComments' : 'leaderComments')

// A member's own comment of one kind (one document per author, id = uid). null when there is none.
export function subscribeMyComment(kind: CommentKind, uid: string, onText: (text: string | null) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(requireDb(), 'guilds', guildId, commentCollection(kind), uid), (snapshot) => {
    const text = snapshot.exists() ? snapshot.data().text : null
    onText(typeof text === 'string' ? text : null)
  }, onError)
}

export async function saveMyComment(kind: CommentKind, uid: string, displayName: string, text: string) {
  await setDoc(doc(requireDb(), 'guilds', guildId, commentCollection(kind), uid), { userId: uid, displayName, text, updatedAt: serverTimestamp() })
}

export async function deleteMyComment(kind: CommentKind, uid: string) {
  await deleteDoc(doc(requireDb(), 'guilds', guildId, commentCollection(kind), uid))
}

export function subscribeMyRaiderType(uid: string, onType: (type: RaiderType | null) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(requireDb(), 'guilds', guildId, 'raiderTypes', uid), (snapshot) => {
    const type = snapshot.exists() ? snapshot.data().type : null
    onType(type === 'casual' || type === 'hardcore' ? type : null)
  }, onError)
}

export async function saveMyRaiderType(uid: string, type: RaiderType) {
  await setDoc(doc(requireDb(), 'guilds', guildId, 'raiderTypes', uid), { userId: uid, type, updatedAt: serverTimestamp() })
}

export async function createRaidEvent(data: Omit<RaidRecord, 'id' | 'createdBy' | 'createdAt'>, uid: string) {
  const startsAt = Timestamp.fromDate(raidStartDate(data.date, raidTimeOf(data)))
  await addDoc(guildCollection('raids'), { ...data, startsAt, createdBy: uid, createdAt: serverTimestamp() })
}

export const RAID_REASON_MAX_LENGTH = 300
export const RAID_DESCRIPTION_MAX_LENGTH = 500
// Raid times are 24-hour HH:MM in Eastern Time. A raid saved without one starts at the usual time.
export const DEFAULT_RAID_TIME = '21:00'
export const raidTimeOf = (raid: Pick<RaidRecord, 'time'>) => raid.time ?? DEFAULT_RAID_TIME
export function formatRaidTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'} ET`
}
export const isRaidCancelled = (raid: Pick<RaidRecord, 'status'>) => raid.status === 'cancelled'

// Who is making a change that is logged: the signed-in leader. The name has to be the one on their guild account (the rules check it).
export type AuditWho = { uid: string; displayName: string }
type RaidWho = AuditWho
const REMOVE_FIELD = deleteField()

// Every raid change is one batch: the raid update and its audit entry (raid_{id}_{rev}). The rules accept
// neither without the other, and check that the entry tells the truth about what changed.
async function writeRaidChange(raid: RaidRecord, changes: Record<string, unknown>, action: 'edit' | 'cancel', who: RaidWho, reason?: string) {
  const database = requireDb()
  const rev = (raid.rev ?? 0) + 1
  const current = raid as unknown as Record<string, unknown>
  const changed = Object.keys(changes).filter((key) => (changes[key] === REMOVE_FIELD ? current[key] !== undefined : changes[key] !== current[key]))
  if (!changed.length) throw new Error('Nothing was changed.')
  const batch = writeBatch(database)
  batch.update(doc(database, 'guilds', guildId, 'raids', raid.id), { ...changes, rev, updatedBy: who.uid, updatedAt: serverTimestamp() })
  batch.set(doc(database, 'guilds', guildId, 'auditLog', `raid_${raid.id}_${rev}`), {
    at: serverTimestamp(),
    by: who.uid,
    byName: who.displayName,
    targetType: 'raid',
    targetId: raid.id,
    rev,
    action,
    item: raid.name,
    changed,
    before: Object.fromEntries(changed.map((key) => [key, current[key] ?? null])),
    after: Object.fromEntries(changed.map((key) => [key, changes[key] === REMOVE_FIELD ? null : changes[key]])),
    ...(reason ? { reason } : {}),
  })
  await batch.commit()
}

export async function updateRaidEvent(raid: RaidRecord, edit: RaidEdit, who: RaidWho) {
  const changes: Record<string, unknown> = {}
  const startsAt = Timestamp.fromDate(raidStartDate(edit.date ?? raid.date, edit.time ?? raidTimeOf(raid)))
  if (!raid.startsAt?.isEqual(startsAt)) changes.startsAt = startsAt
  for (const key of ['name', 'date', 'size'] as const) if (edit[key] !== undefined && edit[key] !== raid[key]) changes[key] = edit[key]
  if (edit.zones !== undefined && !sameRaidZones(edit.zones, raid.zones ?? [])) changes.zones = edit.zones
  if (edit.time !== undefined && edit.time !== raidTimeOf(raid)) changes.time = edit.time
  if (edit.description !== undefined) {
    const text = edit.description.trim()
    if (text !== (raid.description ?? '')) changes.description = text || REMOVE_FIELD
  }
  await writeRaidChange(raid, changes, 'edit', who)
}

export async function cancelRaidEvent(raid: RaidRecord, reason: string, who: RaidWho) {
  const text = reason.trim()
  if (!text) throw new Error('Enter a reason for cancelling the raid.')
  if (isRaidCancelled(raid)) throw new Error('This raid is already cancelled.')
  await writeRaidChange(raid, { status: 'cancelled', cancelReason: text }, 'cancel', who, text)
}

export async function restoreRaidEvent(raid: RaidRecord, who: RaidWho) {
  if (!isRaidCancelled(raid)) throw new Error('This raid is not cancelled.')
  await writeRaidChange(raid, { status: 'scheduled', cancelReason: REMOVE_FIELD }, 'edit', who)
}

// ---- Loot priorities and awards. Every change is one batch of the change and its audit entry (`priority_{id}_{rev}` or `award_{id}_1`).
// The rules accept neither without the other and check that the entry tells the truth (docs/design/audit-first-loot.md), so nothing here can
// skip the log. A batch has a limit on the document lookups the rules may make, so a long list is written in batches of AUDITED_BATCH_SIZE;
// each batch is all or nothing, and `onWritten` is told which ids a batch wrote, so a caller can show progress and report where it stopped.
export const AUDITED_BATCH_SIZE = 10

export type NewPriority = { item: string; encounter: string; rankedPlayers: string[]; councilNote: string; phaseNo: number; itemId?: number; zoneId?: number; npcId?: number; carriedFrom?: string }
// A field set to undefined is taken away.
export type PriorityChanges = Partial<Pick<PriorityRecord, 'item' | 'encounter' | 'rankedPlayers' | 'councilNote' | 'itemId' | 'zoneId' | 'npcId' | 'hidden'>>
export type NewAward = { priorityId: string; item: string; encounter: string; recipient: string; awardedAt: string; prioritySnapshot: string[]; councilNoteSnapshot: string; awardNote: string; phaseNo: number }

// A fresh id for every new priority: an entry id (`priority_{id}_{rev}`) can be used only once, so the id of a deleted priority cannot be created again.
export const newPriorityId = () => crypto.randomUUID()

function auditEntry(who: AuditWho, targetType: 'priority' | 'award' | 'phase', targetId: string, rev: number, action: string, item: string, description: Record<string, unknown>) {
  return { at: serverTimestamp(), by: who.uid, byName: who.displayName, targetType, targetId, rev, action, item, ...description }
}

function inBatches<T>(items: T[]): T[][] {
  const groups: T[][] = []
  for (let start = 0; start < items.length; start += AUDITED_BATCH_SIZE) groups.push(items.slice(start, start + AUDITED_BATCH_SIZE))
  return groups
}

export async function createPriorities(items: { id: string; fields: NewPriority }[], who: AuditWho, onWritten?: (ids: string[]) => void) {
  const database = requireDb()
  for (const group of inBatches(items)) {
    const batch = writeBatch(database)
    for (const { id, fields } of group) {
      const record = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
      batch.set(doc(database, 'guilds', guildId, 'lootPriorities', id), { ...record, rev: 1, updatedBy: who.uid, updatedAt: serverTimestamp() })
      batch.set(doc(database, 'guilds', guildId, 'auditLog', `priority_${id}_1`), auditEntry(who, 'priority', id, 1, 'create', fields.item, describeCreate(record, priorityAuditFields)))
    }
    await batch.commit()
    onWritten?.(group.map((entry) => entry.id))
  }
}

/** Changes a priority and logs it. Returns false, writing nothing, when no field would differ. `reorder` is for a change of `rankedPlayers` alone. */
export async function editPriority(existing: PriorityRecord, changes: PriorityChanges, who: AuditWho, action: 'edit' | 'reorder' = 'edit') {
  const description = describeEdit(existing as unknown as Record<string, unknown>, changes, priorityAuditFields)
  if (!description) return false
  const database = requireDb()
  const rev = (existing.rev ?? 0) + 1
  const update = Object.fromEntries(description.changed.map((key) => [key, changes[key as keyof PriorityChanges] === undefined ? deleteField() : changes[key as keyof PriorityChanges]]))
  const batch = writeBatch(database)
  batch.update(doc(database, 'guilds', guildId, 'lootPriorities', existing.id), { ...update, rev, updatedBy: who.uid, updatedAt: serverTimestamp() })
  batch.set(doc(database, 'guilds', guildId, 'auditLog', `priority_${existing.id}_${rev}`), auditEntry(who, 'priority', existing.id, rev, action, existing.item, description))
  await batch.commit()
  return true
}

// Takes priorities off the list without losing them (hidden: true), or puts them back. A hidden priority keeps its candidates and the awards
// recorded from it, and is left out of every list and count; ticking its item again in Browse drops brings it back as it was. In batches like the rest.
export async function setPrioritiesHidden(priorities: PriorityRecord[], hidden: boolean, who: AuditWho, onDone?: (ids: string[]) => void) {
  const database = requireDb()
  for (const group of inBatches(priorities)) {
    const batch = writeBatch(database)
    const written: string[] = []
    for (const priority of group) {
      const description = describeEdit(priority as unknown as Record<string, unknown>, { hidden: hidden ? true : undefined }, priorityAuditFields)
      if (!description) continue
      const rev = (priority.rev ?? 0) + 1
      batch.update(doc(database, 'guilds', guildId, 'lootPriorities', priority.id), { hidden: hidden ? true : deleteField(), rev, updatedBy: who.uid, updatedAt: serverTimestamp() })
      batch.set(doc(database, 'guilds', guildId, 'auditLog', `priority_${priority.id}_${rev}`), auditEntry(who, 'priority', priority.id, rev, 'edit', priority.item, description))
      written.push(priority.id)
    }
    if (written.length) await batch.commit()
    onDone?.(group.map((priority) => priority.id))
  }
}

// Removes priorities. The awards that were recorded from one keep their own copy of the candidate order, so history is not touched.
export async function deletePriorities(priorities: PriorityRecord[], who: AuditWho, onDeleted?: (ids: string[]) => void) {
  const database = requireDb()
  for (const group of inBatches(priorities)) {
    const batch = writeBatch(database)
    for (const priority of group) {
      const rev = (priority.rev ?? 0) + 1
      batch.delete(doc(database, 'guilds', guildId, 'lootPriorities', priority.id))
      batch.set(doc(database, 'guilds', guildId, 'auditLog', `priority_${priority.id}_${rev}`), auditEntry(who, 'priority', priority.id, rev, 'delete', priority.item, describeDelete(priority as unknown as Record<string, unknown>, priorityAuditFields)))
    }
    await batch.commit()
    onDeleted?.(group.map((priority) => priority.id))
  }
}

/** Records an award made from a priority, with its entry. Returns the new award's id. */
export async function recordAward(award: NewAward, who: AuditWho) {
  const database = requireDb()
  const ref = doc(guildCollection('awards'))
  const batch = writeBatch(database)
  batch.set(ref, { ...award, rev: 1, createdBy: who.uid, createdAt: serverTimestamp() })
  batch.set(doc(database, 'guilds', guildId, 'auditLog', `award_${ref.id}_1`), auditEntry(who, 'award', ref.id, 1, 'create', award.item, describeCreate(award, awardCreateFields)))
  await batch.commit()
  return ref.id
}

/** The newest `max` entries of the audit log, live. Every guild member can read it; nobody can change or delete an entry. */
export function subscribeAuditLog(max: number, onData: (entries: AuditEntry[]) => void, onError: (error: Error) => void) {
  return onSnapshot(
    query(guildCollection('auditLog'), orderBy('at', 'desc'), limit(max)),
    (snapshot) => onData(snapshot.docs.flatMap((entry) => { const read = readAuditEntry(entry.id, entry.data({ serverTimestamps: 'estimate' })); return read ? [read] : [] })),
    (error) => onError(error),
  )
}

export async function updateMembershipRole(uid: string, role: GuildRole) {
  await updateDoc(doc(requireDb(), 'guilds', guildId, 'members', uid), { role })
}

export async function updateMembershipAccess(uid: string, role: GuildRole, playerId: string | null) {
  const database = requireDb()
  const membershipRef = doc(database, 'guilds', guildId, 'members', uid)
  const membership = await getDoc(membershipRef)
  if (!membership.exists()) throw new Error('Guild account no longer exists.')
  const previousPlayerId = typeof membership.data().playerId === 'string' ? membership.data().playerId as string : null
  const batch = writeBatch(database)

  if (previousPlayerId && previousPlayerId !== playerId) {
    batch.update(doc(database, 'guilds', guildId, 'roster', previousPlayerId), { linkedUid: deleteField() })
  }
  if (playerId && previousPlayerId !== playerId) {
    batch.update(doc(database, 'guilds', guildId, 'roster', playerId), { linkedUid: uid })
  }
  batch.update(membershipRef, { role, playerId })
  await batch.commit()
}

export async function setMembershipRemoved(uid: string, removed: boolean) {
  await writeMembershipRemoved(requireDb(), guildId, uid, removed)
}

export async function approveJoinRequest(request: JoinRequestRecord, role: GuildRole, playerId: string | null = null) {
  const database = requireDb()
  // Approving writes the whole members doc, so approving someone who is already a member would overwrite their role.
  // The rules refuse it too; this check only gives a readable message.
  if ((await getDoc(doc(database, 'guilds', guildId, 'members', request.userId))).exists()) {
    throw new Error('This person is already a guild member. Decline the request to dismiss it.')
  }
  const batch = writeBatch(database)
  batch.set(doc(database, 'guilds', guildId, 'members', request.userId), {
    email: request.email,
    displayName: request.displayName,
    role,
    playerId,
    joinedAt: serverTimestamp(),
  })
  if (playerId) batch.update(doc(database, 'guilds', guildId, 'roster', playerId), { linkedUid: request.userId })
  batch.update(doc(database, 'guilds', guildId, 'joinRequests', request.userId), { status: 'approved', assignedRole: role, linkedPlayerId: playerId })
  await batch.commit()
}

export async function rejectJoinRequest(uid: string) {
  await updateDoc(doc(requireDb(), 'guilds', guildId, 'joinRequests', uid), { status: 'rejected' })
}

export function currentAuthUser() {
  return auth?.currentUser ?? null
}
