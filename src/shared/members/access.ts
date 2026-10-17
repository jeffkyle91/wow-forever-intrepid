import { deleteField, doc, runTransaction, type Firestore } from 'firebase/firestore'

export async function setMembershipRemoved(database: Firestore, guildId: string, uid: string, removed: boolean) {
  const memberRef = doc(database, 'guilds', guildId, 'members', uid)
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(memberRef)
    if (!snapshot.exists()) throw new Error('Guild account no longer exists.')
    const member = snapshot.data()
    if ((member.role === 'Removed') === removed) throw new Error(removed ? 'This account is already removed.' : 'This account is no longer removed.')
    const previousPlayerId = typeof member.playerId === 'string' ? member.playerId : null
    const playerRef = previousPlayerId ? doc(database, 'guilds', guildId, 'roster', previousPlayerId) : null
    const player = playerRef ? await transaction.get(playerRef) : null
    if (playerRef && player?.exists() && player.data().linkedUid === uid) transaction.update(playerRef, { linkedUid: deleteField() })
    transaction.update(memberRef, { role: removed ? 'Removed' : 'Member', playerId: null })
  })
}
