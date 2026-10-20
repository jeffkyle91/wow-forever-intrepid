import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { id, input, membership } from './access.js'
import { standingDefinitions } from './standingTeams.js'

const activeRoles = ['Guild Leader', 'Raid Leader', 'Member']
const defaultNames = { blue: 'Blue', yellow: 'Yellow', red: 'Red', white: 'White', green: 'Green', pink: 'Pink', brown: 'Brown' }
export const planningRef = (raid) => raid.collection('planning').doc('working')
const records = (snapshot) => snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }))
const open = (raid) => raid && raid.status !== 'cancelled' && raid.startsAt instanceof Timestamp && raid.startsAt.toMillis() > Date.now()
const sizesOf = (raid) => [...new Set(raid.zones?.length ? raid.zones.map((zone) => zone.size) : [raid.size])]
const overlaps = (entry, date) => entry.startDate <= date && date <= entry.endDate

function requireOpen(raid) {
  if (!open(raid)) throw new HttpsError('failed-precondition', 'Planning is closed: this raid is cancelled, has started, or needs a saved start time.')
}

function requireLeader(member) {
  if (!['Guild Leader', 'Raid Leader'].includes(member.role)) throw new HttpsError('permission-denied', 'Only Guild and Raid Leaders can change a scheduled lineup.')
}

export function characterOwner(characterId, roster, members) {
  const character = roster.find((entry) => entry.id === characterId)
  const main = character?.mainId ? roster.find((entry) => entry.id === character.mainId && !entry.mainId) : character
  if (!character || !main || main.mainId || !main.linkedUid || (character.linkedUid && character.linkedUid !== main.linkedUid)) return undefined
  return members.find((member) => member.id === main.linkedUid && member.playerId === main.id && activeRoles.includes(member.role))
}

function identity(characterId, roster) {
  const character = roster.find((entry) => entry.id === characterId)
  return character?.mainId && roster.some((entry) => entry.id === character.mainId && !entry.mainId) ? character.mainId : characterId
}

export function eligibleInvitations(roster, members, readiness) {
  const ready = new Set(readiness.filter((entry) => entry.ready === true).map((entry) => entry.id))
  return members.filter((member) => activeRoles.includes(member.role)
    && ready.has(member.playerId)
    && roster.some((entry) => entry.id === member.playerId && !entry.mainId && entry.linkedUid === member.id))
    .map((member) => ({ uid: member.id, mainId: member.playerId }))
}

function validateTeams(lineup, roster) {
  for (const team of lineup.teams) {
    if (team.characterIds.length > lineup.size) throw new HttpsError('failed-precondition', `${team.name} exceeds its ${lineup.size}-player capacity. Resolve the standing assignments before copying this size.`)
    const identities = team.characterIds.map((characterId) => identity(characterId, roster))
    if (new Set(identities).size !== identities.length) throw new HttpsError('failed-precondition', `${team.name} contains multiple characters belonging to one player. Resolve the standing assignments before copying this size.`)
  }
}

export function seedPlanning(raid, roster, members, readiness, assignments, settings, signups, absences) {
  const absentIds = new Set()
  for (const player of roster) {
    const owner = characterOwner(player.id, roster, members)
    if (owner && (signups.some((entry) => entry.id === owner.id && entry.status === 'absent')
      || absences.some((entry) => entry.userId === owner.id && overlaps(entry, raid.date)))) absentIds.add(player.id)
  }
  const names = { ...defaultNames, ...settings?.teamNames, ...settings?.groupNames }
  const lineups = standingDefinitions.map(({ size, teams }) => ({
    size,
    teams: teams.map((key) => ({
      key, name: names[key],
      characterIds: roster.filter((player) => !absentIds.has(player.id) && assignments[size].some((assignment) => assignment.id === player.id && assignment.team === key)).map((player) => player.id),
    })),
    bench: [],
  }))
  for (const lineup of lineups.filter((entry) => sizesOf(raid).includes(entry.size))) validateTeams(lineup, roster)
  return { schemaVersion: 1, revision: 1, invitations: eligibleInvitations(roster, members, readiness), lineups }
}

async function readContext(tx, guild, raidRef) {
  const [raid, plan, roster, members, readiness, signups, absences] = await Promise.all([
    tx.get(raidRef), tx.get(planningRef(raidRef)), tx.get(guild.collection('roster')), tx.get(guild.collection('members')),
    tx.get(guild.collection('characterReadiness')), tx.get(raidRef.collection('signups')), tx.get(guild.collection('afkEntries')),
  ])
  return { raid: raid.data(), plan: plan.data(), roster: records(roster), members: records(members), readiness: records(readiness), signups: records(signups), absences: records(absences) }
}

function checkedPlan(plan) {
  if (!plan || plan.schemaVersion !== 1 || !Number.isSafeInteger(plan.revision) || !Array.isArray(plan.lineups) || !Array.isArray(plan.invitations)) {
    throw new HttpsError('failed-precondition', 'This raid has no readable working roster. Ask a leader to initialize it.')
  }
  return plan
}

function writePlan(tx, ref, plan) {
  tx.set(ref, { ...plan, updatedAt: FieldValue.serverTimestamp() })
}

export async function initializePlanning(db, request) {
  const data = input(request, ['guildId', 'raidId'])
  const guild = db.collection('guilds').doc(data.guildId)
  const raidRef = guild.collection('raids').doc(id(data.raidId))
  await db.runTransaction(async (tx) => {
    requireLeader(await membership(tx, guild, data.uid))
    const context = await readContext(tx, guild, raidRef)
    requireOpen(context.raid)
    if (context.plan) { checkedPlan(context.plan); return }
    const [assignments10, assignments20, assignments40, settings] = await Promise.all([
      ...standingDefinitions.map((definition) => tx.get(guild.collection(definition.collection))), tx.get(guild.collection('settings').doc('general')),
    ])
    const plan = seedPlanning(context.raid, context.roster, context.members, context.readiness, { 10: records(assignments10), 20: records(assignments20), 40: records(assignments40) }, settings.data(), context.signups, context.absences)
    requireOpen(context.raid)
    writePlan(tx, planningRef(raidRef), { ...plan, createdAt: FieldValue.serverTimestamp(), initializedBy: data.uid })
  })
  return { initialized: true }
}

export async function synchronizePlanning(db, guildId, raidId) {
  const guild = db.collection('guilds').doc(id(guildId))
  const ref = guild.collection('raids').doc(id(raidId))
  await db.runTransaction(async (tx) => {
    const context = await readContext(tx, guild, ref)
    if (!open(context.raid) || !context.plan) return
    const plan = checkedPlan(context.plan)
    const additions = eligibleInvitations(context.roster, context.members, context.readiness).filter((entry) => !plan.invitations.some((invited) => invited.uid === entry.uid))
    if (!additions.length) return
    if (!open(context.raid)) return
    writePlan(tx, planningRef(ref), { ...plan, revision: plan.revision + 1, invitations: [...plan.invitations, ...additions] })
  })
}

export async function synchronizePlanningGuild(db, guildId) {
  const guild = db.collection('guilds').doc(id(guildId))
  const raids = await guild.collection('raids').where('startsAt', '>', Timestamp.now()).get()
  for (const raid of raids.docs) await synchronizePlanning(db, guildId, raid.id)
}

export async function changePlacement(db, request) {
  const data = input(request, ['guildId', 'raidId', 'size', 'characterId', 'destination', 'revision', 'acknowledgeAbsence'])
  id(data.raidId)
  id(data.characterId)
  if (![10, 20, 40].includes(data.size) || typeof data.destination !== 'string' || !Number.isSafeInteger(data.revision)
    || typeof data.acknowledgeAbsence !== 'boolean') throw new HttpsError('invalid-argument', 'Choose a valid lineup, destination and current revision.')
  const guild = db.collection('guilds').doc(data.guildId)
  const raidRef = guild.collection('raids').doc(data.raidId)
  await db.runTransaction(async (tx) => {
    requireLeader(await membership(tx, guild, data.uid))
    const context = await readContext(tx, guild, raidRef)
    requireOpen(context.raid)
    const plan = checkedPlan(context.plan)
    if (plan.revision !== data.revision) throw new HttpsError('aborted', 'The working roster changed. Review the latest lineup and try again.')
    if (!sizesOf(context.raid).includes(data.size)) throw new HttpsError('failed-precondition', 'That size is not used by this raid.')
    const lineup = plan.lineups.find((entry) => entry.size === data.size)
    if (!lineup || !['unassigned', 'bench', ...lineup.teams.map((entry) => entry.key)].includes(data.destination)) {
      throw new HttpsError('invalid-argument', 'Choose a destination in this lineup.')
    }
    if (data.destination !== 'unassigned') {
      const owner = characterOwner(data.characterId, context.roster, context.members)
      const character = context.roster.find((entry) => entry.id === data.characterId)
      const signup = context.signups.find((entry) => entry.id === owner?.id)
      if (!owner || !character || !context.readiness.some((entry) => entry.id === character.id && entry.ready === true)) {
        throw new HttpsError('failed-precondition', 'New placements require a ready character linked to an active guild member.')
      }
      if (data.characterId !== (signup?.characterId ?? owner.playerId)) {
        throw new HttpsError('failed-precondition', 'The member must select this character in their sign-up before you can place it.')
      }
      const absent = signup?.status === 'absent' || context.absences.some((entry) => entry.userId === owner.id && overlaps(entry, context.raid.date))
      if (absent && !data.acknowledgeAbsence) throw new HttpsError('failed-precondition', 'This member is Absent or unavailable. Explicitly acknowledge the warning before placing them.')
    }
    const next = {
      ...lineup,
      teams: lineup.teams.map((team) => ({ ...team, characterIds: team.characterIds.filter((characterId) => characterId !== data.characterId) })),
      bench: lineup.bench.filter((characterId) => characterId !== data.characterId),
    }
    if (data.destination === 'bench') next.bench.push(data.characterId)
    else if (data.destination !== 'unassigned') {
      const target = next.teams.find((team) => team.key === data.destination)
      target.characterIds.push(data.characterId)
      validateTeams({ ...next, teams: [target] }, context.roster)
    }
    requireOpen(context.raid)
    writePlan(tx, planningRef(raidRef), { ...plan, revision: plan.revision + 1, lineups: plan.lineups.map((entry) => entry.size === data.size ? next : entry) })
  })
  return { saved: true }
}

// Read these before any transaction writes. Response/availability changes and leader edits contend on the same working document.
export async function clearedPlanning(tx, guild, uid, raids) {
  if (!raids.length) return []
  const roster = records(await tx.get(guild.collection('roster')))
  const main = roster.find((entry) => entry.linkedUid === uid && !entry.mainId)
  const ownedIds = new Set(main ? roster.filter((entry) => entry.id === main.id || (entry.mainId === main.id && (!entry.linkedUid || entry.linkedUid === uid))).map((entry) => entry.id) : [])
  const updates = []
  for (const raid of raids) {
    if (!open(raid.data())) continue
    const ref = planningRef(raid.ref)
    const plan = (await tx.get(ref)).data()
    if (!plan) continue
    checkedPlan(plan)
    const lineups = plan.lineups.map((lineup) => ({
      ...lineup,
      teams: lineup.teams.map((team) => ({ ...team, characterIds: team.characterIds.filter((characterId) => !ownedIds.has(characterId)) })),
      bench: lineup.bench.filter((characterId) => !ownedIds.has(characterId)),
    }))
    if (JSON.stringify(lineups) !== JSON.stringify(plan.lineups)) updates.push({ ref, plan: { ...plan, revision: plan.revision + 1, lineups } })
  }
  return updates
}

export function writeClearedPlanning(tx, updates) {
  for (const { ref, plan } of updates) writePlan(tx, ref, plan)
}

export function startInstant(date, time) {
  if (typeof date !== 'string' || typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new HttpsError('invalid-argument', 'Enter a valid raid date and Eastern start time.')
  }
  const wall = Date.parse(`${date}T${time}:00Z`)
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== date) throw new HttpsError('invalid-argument', 'Enter a valid raid date.')
  const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  for (const offset of [4, 5]) {
    const instant = new Date(wall + offset * 3_600_000)
    const parts = Object.fromEntries(eastern.formatToParts(instant).map(({ type, value }) => [type, value]))
    if (`${parts.year}-${parts.month}-${parts.day}` === date && `${parts.hour}:${parts.minute}` === time) return Timestamp.fromDate(instant)
  }
  throw new HttpsError('invalid-argument', 'That Eastern start time does not exist because of daylight saving time.')
}

export async function createScheduledRaid(db, request) {
  const data = input(request, ['guildId', 'raidId', 'name', 'date', 'time', 'zones', 'description'])
  const raidId = id(data.raidId)
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 80
    || (data.description !== undefined && (typeof data.description !== 'string' || data.description.trim().length > 500))
    || !Array.isArray(data.zones) || !data.zones.length || data.zones.length > 10
    || data.zones.some((zone) => !zone || typeof zone !== 'object' || Array.isArray(zone)
      || Object.keys(zone).sort().join(',') !== 'id,name,size'
      || typeof zone.id !== 'string' || !zone.id || zone.id.length > 100 || zone.id.includes('/')
      || typeof zone.name !== 'string' || !zone.name.trim() || zone.name.length > 80 || ![10, 20, 40].includes(zone.size))
    || new Set(data.zones.map((zone) => zone.id)).size !== data.zones.length) {
    throw new HttpsError('invalid-argument', 'Enter a raid name and select one to ten distinct configured zones.')
  }
  const startsAt = startInstant(data.date, data.time)
  if (startsAt.toMillis() <= Date.now()) throw new HttpsError('failed-precondition', 'Choose a future start time for a new scheduled raid.')
  const guild = db.collection('guilds').doc(data.guildId)
  const ref = guild.collection('raids').doc(raidId)
  await db.runTransaction(async (tx) => {
    requireLeader(await membership(tx, guild, data.uid))
    if ((await tx.get(ref)).exists) throw new HttpsError('already-exists', 'That raid was already created. Close this dialog and check the calendar.')
    const [roster, members, readiness, assignments10, assignments20, assignments40, settings, absences] = await Promise.all([
      tx.get(guild.collection('roster')), tx.get(guild.collection('members')), tx.get(guild.collection('characterReadiness')),
      ...standingDefinitions.map((definition) => tx.get(guild.collection(definition.collection))), tx.get(guild.collection('settings').doc('general')),
      tx.get(guild.collection('afkEntries')),
    ])
    // Like the existing audited raid editor, leaders supply validated zone snapshots, including built-in and guild-created zones.
    const snapshots = data.zones.map((zone) => ({ id: zone.id, name: zone.name.trim(), size: zone.size }))
    const raid = { name: data.name.trim(), date: data.date, time: data.time, startsAt, zones: snapshots, size: Math.max(...snapshots.map((zone) => zone.size)), ...(data.description?.trim() ? { description: data.description.trim() } : {}), createdBy: data.uid, createdAt: FieldValue.serverTimestamp() }
    const plan = seedPlanning(raid, records(roster), records(members), records(readiness), { 10: records(assignments10), 20: records(assignments20), 40: records(assignments40) }, settings.data(), [], records(absences))
    tx.create(ref, raid)
    writePlan(tx, planningRef(ref), { ...plan, createdAt: FieldValue.serverTimestamp(), initializedBy: data.uid })
  })
  return { id: raidId }
}
