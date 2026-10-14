// Arranging a starting state that differs from the baseline, with the rules off, before the thing under test.
import { setDoc, updateDoc } from 'firebase/firestore'
import type { GuildRole } from '../../../src/security.ts'
import { joinRequestDoc, memberDoc } from './fixtures.ts'
import { asAdmin, guildDoc } from './harness.ts'

/** Add a member (optionally linked to a character) without going through the rules. */
export async function addMember(uid: string, role: GuildRole, playerId: string | null = null): Promise<void> {
  await asAdmin(async (db) => {
    await setDoc(guildDoc(db, `members/${uid}`), memberDoc(uid, role, playerId))
    if (playerId) await updateDoc(guildDoc(db, `roster/${playerId}`), { linkedUid: uid })
  })
}

/** Put a join request in the guild, pending unless the overrides say otherwise. */
export async function addJoinRequest(uid: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await asAdmin((db) => setDoc(guildDoc(db, `joinRequests/${uid}`), joinRequestDoc(uid, overrides)))
}
