import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import { auth, db, guildId } from './firebase'
import type { GuildRole } from './security'
import { normalizeDocs, type Normalizer } from './shared/lib/normalize'

export type TenManTeam = 'blue' | 'yellow' | 'red' | 'white'
export type RaidGroup = 'green' | 'pink' | 'brown'
export type PlayerRecord = { id: string; name: string; className: string; specialization: string; role: 'Tank' | 'Healer' | 'Melee' | 'Ranged'; linkedUid?: string; mainId?: string; surname?: string }
export type PriorityRecord = { id: string; item: string; encounter: string; rankedPlayers: string[]; councilNote: string }
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
}
export type AfkEntryRecord = { id: string; userId: string; displayName: string; startDate: string; endDate: string; createdAt?: unknown }
export type CommentKind = 'public' | 'leadership'
export const COMMENT_MAX_LENGTH = 300
export type RaiderType = 'casual' | 'hardcore'
export type RaidStatus = 'scheduled' | 'cancelled'
export type RaidRecord = {
  id: string
  date: string
  name: string
  size: 10 | 20 | 40
  description?: string
  createdBy: string
  createdAt?: unknown
  rev?: number
  status?: RaidStatus
  cancelReason?: string
}
export type RaidEdit = Partial<Pick<RaidRecord, 'name' | 'date' | 'size' | 'description'>>
export type MembershipRecord = { id: string; email: string; displayName: string; role: GuildRole; playerId?: string | null }
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

// A field set to undefined is removed from the stored document (the write merges, so it would otherwise stay).
export async function saveGuildRecord(collectionName: 'roster' | 'lootPriorities', id: string, data: Record<string, unknown>) {
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === undefined ? deleteField() : value]))
  await setDoc(doc(requireDb(), 'guilds', guildId, collectionName, id), fields, { merge: true })
}

export async function setTeamAssignment(playerId: string, team: TenManTeam | null) {
  const assignmentRef = doc(requireDb(), 'guilds', guildId, 'teamAssignments', playerId)
  if (team) await setDoc(assignmentRef, { team })
  else await deleteDoc(assignmentRef)
}

// Guild Leaders only: the rules refuse everyone else, and refuse a document that is not exactly this shape.
export async function saveGuildSettings(settings: GuildSettings) {
  await setDoc(doc(requireDb(), 'guilds', guildId, 'settings', 'general'), settings)
}

export async function createAward(data: Omit<AwardRecord, 'id'>) {
  await addDoc(guildCollection('awards'), data)
}

export async function createAfkEntry(data: Omit<AfkEntryRecord, 'id' | 'createdAt'>) {
  await addDoc(guildCollection('afkEntries'), { ...data, createdAt: serverTimestamp() })
}

export async function deleteAfkEntry(id: string) {
  await deleteDoc(doc(requireDb(), 'guilds', guildId, 'afkEntries', id))
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
  await addDoc(guildCollection('raids'), { ...data, createdBy: uid, createdAt: serverTimestamp() })
}

export const RAID_REASON_MAX_LENGTH = 300
export const RAID_DESCRIPTION_MAX_LENGTH = 500
export const isRaidCancelled = (raid: Pick<RaidRecord, 'status'>) => raid.status === 'cancelled'

type RaidWho = { uid: string; displayName: string }
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
    after: Object.fromEntries(changed.map((key) => [key, typeof changes[key] === 'object' ? null : changes[key]])),
    ...(reason ? { reason } : {}),
  })
  await batch.commit()
}

export async function updateRaidEvent(raid: RaidRecord, edit: RaidEdit, who: RaidWho) {
  const changes: Record<string, unknown> = {}
  for (const key of ['name', 'date', 'size'] as const) if (edit[key] !== undefined && edit[key] !== raid[key]) changes[key] = edit[key]
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

export async function importLocalPreviewData() {
  const database = requireDb()
  const existing = await Promise.all(['roster', 'teamAssignments', 'lootPriorities', 'awards'].map((name) => getDocs(guildCollection(name))))
  if (existing.some((snapshot) => !snapshot.empty)) throw new Error('Import is only available when the guild has no roster, teams, priorities, or awards.')

  const local = (key: string) => {
    try {
      return JSON.parse(localStorage.getItem(`intrepid-loot-council-v1-${key}`) ?? '[]') as Record<string, unknown>[]
    } catch {
      return []
    }
  }
  const roster = local('roster')
  const savedAssignments = (() => {
    try {
      return JSON.parse(localStorage.getItem('intrepid-loot-council-v1-team-assignments') ?? '{}') as Record<string, TenManTeam>
    } catch {
      return {}
    }
  })()
  const priorities = local('priorities')
  const awards = local('awards')
  const batch = writeBatch(database)

  for (const player of roster) {
    const { id, team, ...record } = player
    if (typeof id !== 'string') continue
    batch.set(doc(database, 'guilds', guildId, 'roster', id), record)
    const assignment = savedAssignments[id] ?? (team === 'A' ? 'blue' : team === 'B' ? 'red' : null)
    if (assignment && ['blue', 'yellow', 'red', 'white'].includes(assignment)) {
      batch.set(doc(database, 'guilds', guildId, 'teamAssignments', id), { team: assignment })
    }
  }
  for (const priority of priorities) {
    const { id, ...record } = priority
    if (typeof id === 'string') batch.set(doc(database, 'guilds', guildId, 'lootPriorities', id), record)
  }
  for (const award of awards) {
    const { id, ...record } = award
    if (typeof id === 'string') batch.set(doc(database, 'guilds', guildId, 'awards', id), {
      ...record,
      priorityId: typeof award.priorityId === 'string' ? award.priorityId : 'legacy-import',
      prioritySnapshot: Array.isArray(award.prioritySnapshot) ? award.prioritySnapshot : Array.isArray(award.priorityAtAward) ? award.priorityAtAward : [],
      councilNoteSnapshot: typeof award.councilNoteSnapshot === 'string' ? award.councilNoteSnapshot : typeof award.councilNoteAtAward === 'string' ? award.councilNoteAtAward : '',
    })
  }
  await batch.commit()
  return roster.length + priorities.length + awards.length
}

export function currentAuthUser() {
  return auth?.currentUser ?? null
}
