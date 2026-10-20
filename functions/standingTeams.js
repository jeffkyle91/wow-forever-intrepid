import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { id, input, membership } from './access.js'

export const standingDefinitions = [
  { size: 10, collection: 'teamAssignments', teams: ['blue', 'yellow', 'red', 'white'] },
  { size: 20, collection: 'teamAssignments20', teams: ['green', 'pink'] },
  { size: 40, collection: 'teamAssignments40', teams: ['brown'] },
]

export async function changeStandingTeam(db, request) {
  const data = input(request, ['guildId', 'size', 'characterId', 'team'])
  id(data.characterId)
  const definition = standingDefinitions.find((entry) => entry.size === data.size)
  if (!definition || (data.team !== null && !definition.teams.includes(data.team))) throw new HttpsError('invalid-argument', 'Choose a standing team of the selected size.')
  const guild = db.collection('guilds').doc(data.guildId)
  const ref = guild.collection(definition.collection).doc(data.characterId)
  await db.runTransaction(async (tx) => {
    const member = await membership(tx, guild, data.uid)
    if (!['Guild Leader', 'Raid Leader'].includes(member.role)) throw new HttpsError('permission-denied', 'Only Guild and Raid Leaders can edit standing teams.')
    const [roster, assignments, readiness] = await Promise.all([
      tx.get(guild.collection('roster')), tx.get(guild.collection(definition.collection)), tx.get(guild.collection('characterReadiness').doc(data.characterId)),
    ])
    if (data.team === null) { tx.delete(ref); return }
    const lock = guild.collection('standingTeamLocks').doc(`${data.size}_${data.team}`)
    await tx.get(lock)
    const characters = roster.docs.map((entry) => ({ ...entry.data(), id: entry.id }))
    const character = characters.find((entry) => entry.id === data.characterId)
    if (!character || readiness.data()?.ready !== true) throw new HttpsError('failed-precondition', 'Only raid-ready characters can be added or moved. Existing unready assignments may be removed.')
    const peers = assignments.docs.filter((entry) => entry.id !== data.characterId && entry.data().team === data.team)
    if (peers.length >= data.size) throw new HttpsError('failed-precondition', 'That standing team is full.')
    const identity = (entry) => entry.mainId && characters.some((main) => main.id === entry.mainId && !main.mainId) ? entry.mainId : entry.id
    if (peers.some((entry) => {
      const peer = characters.find((candidate) => candidate.id === entry.id)
      return peer && identity(peer) === identity(character)
    })) throw new HttpsError('failed-precondition', 'Another character belonging to this player is already on that team.')
    tx.set(ref, { team: data.team })
    tx.set(lock, { updatedAt: FieldValue.serverTimestamp() })
  })
  return { saved: true }
}
