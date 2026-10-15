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
export type RaidRecord = { id: string; date: string; name: string; size: 10 | 20 | 40; createdBy: string; createdAt?: unknown }
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

export async function createRaidEvent(data: Omit<RaidRecord, 'id' | 'createdBy' | 'createdAt'>, uid: string) {
  await addDoc(guildCollection('raids'), { ...data, createdBy: uid, createdAt: serverTimestamp() })
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
