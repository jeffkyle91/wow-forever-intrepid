import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

const roles = ['Guild Leader', 'Raid Leader', 'Member']
const statuses = ['accept', 'tentative', 'absent', 'late', 'bench']
const todayEastern = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const overlaps = (entry, date) => entry.startDate <= date && date <= entry.endDate
const upcoming = (raid) => (!raid.status || raid.status === 'scheduled') && (raid.startsAt instanceof Timestamp ? raid.startsAt.toMillis() > Date.now() : raid.date >= todayEastern())

function id(value) {
  if (typeof value !== 'string' || !value || value.includes('/') || value.length > 1500) throw new HttpsError('invalid-argument', 'A valid document id is required.')
  return value
}

function input(request, keys) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to continue.')
  const data = request.data
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some((key) => !keys.includes(key))) {
    throw new HttpsError('invalid-argument', 'Unsupported request fields.')
  }
  id(data.guildId)
  return { ...data, uid: request.auth.uid }
}

async function membership(tx, guild, uid) {
  const member = (await tx.get(guild.collection('members').doc(uid))).data()
  if (!member || !roles.includes(member.role)) throw new HttpsError('permission-denied', 'Guild membership is required.')
  return member
}

// All availability and response mutations for an account share this server-only transaction lock.
async function lockMember(tx, guild, uid) {
  const ref = guild.collection('availabilityLocks').doc(uid)
  await tx.get(ref)
  return ref
}

async function ownedCharacter(tx, guild, member, uid, characterId) {
  if (typeof member.playerId !== 'string' || !member.playerId) throw new HttpsError('failed-precondition', 'A leader must link your account to a main character.')
  const main = (await tx.get(guild.collection('roster').doc(id(member.playerId)))).data()
  const character = characterId === member.playerId ? main : (await tx.get(guild.collection('roster').doc(id(characterId)))).data()
  if (!main || main.mainId || main.linkedUid !== uid || !character
    || (characterId !== member.playerId && (character.mainId !== member.playerId || (character.linkedUid && character.linkedUid !== uid)))) {
    throw new HttpsError('permission-denied', 'Choose one of your currently linked characters.')
  }
}

export async function saveResponse(db, request) {
  const data = input(request, ['guildId', 'raidId', 'characterId', 'status'])
  id(data.raidId)
  id(data.characterId)
  if (data.characterId.length > 100) throw new HttpsError('invalid-argument', 'The character id is too long.')
  if (!statuses.includes(data.status)) throw new HttpsError('invalid-argument', 'Choose a valid raid response.')
  const guild = db.collection('guilds').doc(data.guildId)
  await db.runTransaction(async (tx) => {
    const member = await membership(tx, guild, data.uid)
    const lock = await lockMember(tx, guild, data.uid)
    const raid = (await tx.get(guild.collection('raids').doc(data.raidId))).data()
    if (!raid || (raid.status && raid.status !== 'scheduled') || !(raid.startsAt instanceof Timestamp) || raid.startsAt.toMillis() <= Date.now()) {
      throw new HttpsError('failed-precondition', 'This raid is cancelled, has started, or does not have sign-ups enabled.')
    }
    await ownedCharacter(tx, guild, member, data.uid, data.characterId)
    const entries = await tx.get(guild.collection('afkEntries').where('userId', '==', data.uid))
    if (entries.docs.some((entry) => overlaps(entry.data(), raid.date))) {
      throw new HttpsError('failed-precondition', 'You are marked unavailable. Remove all overlapping unavailable events before changing your response.')
    }
    tx.set(guild.collection('raids').doc(data.raidId).collection('signups').doc(data.uid), {
      characterId: data.characterId, status: data.status, updatedAt: FieldValue.serverTimestamp(),
      ...(data.status === 'bench' ? { benchKind: 'self' } : {}),
    })
    tx.set(lock, { updatedAt: FieldValue.serverTimestamp() })
  })
  return { saved: true }
}

async function absenceWrites(tx, guild, uid, member, raids) {
  const writes = []
  for (const raid of raids) {
    if (!upcoming(raid.data())) continue
    const ref = raid.ref.collection('signups').doc(uid)
    const existing = (await tx.get(ref)).data()
    let characterId = existing?.characterId
    if (!characterId && typeof member?.playerId === 'string' && member.playerId) {
      const main = (await tx.get(guild.collection('roster').doc(member.playerId))).data()
      if (main?.linkedUid === uid && !main.mainId) characterId = member.playerId
    }
    if (characterId && existing?.status !== 'absent') writes.push({ ref, characterId })
  }
  return writes
}

function setAbsent(tx, writes) {
  for (const { ref, characterId } of writes) tx.set(ref, { characterId, status: 'absent', updatedAt: FieldValue.serverTimestamp() })
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export async function addAbsence(db, request) {
  const data = input(request, ['guildId', 'startDate', 'endDate'])
  if (!validDate(data.startDate) || !validDate(data.endDate) || data.startDate > data.endDate) {
    throw new HttpsError('invalid-argument', 'Choose valid unavailable dates with the start on or before the end.')
  }
  const guild = db.collection('guilds').doc(data.guildId)
  const entry = guild.collection('afkEntries').doc()
  await db.runTransaction(async (tx) => {
    const member = await membership(tx, guild, data.uid)
    const lock = await lockMember(tx, guild, data.uid)
    const raids = await tx.get(guild.collection('raids').where('date', '>=', data.startDate).where('date', '<=', data.endDate))
    const writes = await absenceWrites(tx, guild, data.uid, member, raids.docs)
    setAbsent(tx, writes)
    tx.create(entry, { userId: data.uid, displayName: member.displayName, startDate: data.startDate, endDate: data.endDate, createdAt: FieldValue.serverTimestamp() })
    tx.set(lock, { updatedAt: FieldValue.serverTimestamp() })
  })
  return { id: entry.id }
}

export async function removeAbsence(db, request) {
  const data = input(request, ['guildId', 'entryId'])
  id(data.entryId)
  const guild = db.collection('guilds').doc(data.guildId)
  const ref = guild.collection('afkEntries').doc(data.entryId)
  await db.runTransaction(async (tx) => {
    const member = await membership(tx, guild, data.uid)
    const lock = await lockMember(tx, guild, data.uid)
    const entry = (await tx.get(ref)).data()
    if (!entry || entry.userId !== data.uid) throw new HttpsError('permission-denied', 'Only the owner can remove unavailable dates.')
    const raids = await tx.get(guild.collection('raids').where('date', '>=', entry.startDate).where('date', '<=', entry.endDate))
    // Persist Absent even for legacy events that have not been backfilled yet.
    const writes = await absenceWrites(tx, guild, data.uid, member, raids.docs)
    setAbsent(tx, writes)
    tx.delete(ref)
    tx.set(lock, { updatedAt: FieldValue.serverTimestamp() })
  })
  return { removed: true }
}

export async function synchronizeRaid(db, guildId, raidId) {
  const guild = db.collection('guilds').doc(id(guildId))
  const raidRef = guild.collection('raids').doc(id(raidId))
  const initial = (await raidRef.get()).data()
  if (!initial || !upcoming(initial)) return
  const entries = await guild.collection('afkEntries').get()
  const uids = new Set(entries.docs.filter((entry) => overlaps(entry.data(), initial.date)).map((entry) => entry.data().userId))
  for (const uid of uids) {
    await db.runTransaction(async (tx) => {
      const lock = await lockMember(tx, guild, uid)
      const member = (await tx.get(guild.collection('members').doc(uid))).data()
      const raid = await tx.get(raidRef)
      const currentEntries = await tx.get(guild.collection('afkEntries').where('userId', '==', uid))
      if (!raid.exists || !upcoming(raid.data()) || !currentEntries.docs.some((entry) => overlaps(entry.data(), raid.data().date))) return
      const writes = await absenceWrites(tx, guild, uid, member, [raid])
      setAbsent(tx, writes)
      tx.set(lock, { updatedAt: FieldValue.serverTimestamp() })
    })
  }
}

export async function synchronizeGuild(db, request) {
  const data = input(request, ['guildId'])
  const guild = db.collection('guilds').doc(data.guildId)
  const member = (await guild.collection('members').doc(data.uid).get()).data()
  if (member?.role !== 'Guild Leader') throw new HttpsError('permission-denied', 'Only a Guild Leader can synchronize existing raid absences.')
  const raids = await guild.collection('raids').where('date', '>=', todayEastern()).get()
  for (const raid of raids.docs) await synchronizeRaid(db, data.guildId, raid.id)
  return { checkedRaids: raids.size }
}

export async function synchronizeMember(db, guildId, uid) {
  const guild = db.collection('guilds').doc(id(guildId))
  const entries = await guild.collection('afkEntries').where('userId', '==', id(uid)).get()
  if (entries.empty) return
  const raids = await guild.collection('raids').where('date', '>=', todayEastern()).get()
  for (const raid of raids.docs) {
    if (entries.docs.some((entry) => overlaps(entry.data(), raid.data().date))) await synchronizeRaid(db, guildId, raid.id)
  }
}
