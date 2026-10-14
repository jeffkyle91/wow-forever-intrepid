// The multi-document writes the app makes, rebuilt here against a Firestore handle the tests pass in.
//
// src/guildApi.ts cannot be imported by Node (it pulls in the Vite-only Firebase setup and uses the
// app's own `db`), so these are copies of its batches. They must stay in step with it: if you change
// how approveJoinRequest or updateMembershipAccess build their batches, change them here too, or the
// tests stop describing what the app really sends.
import { deleteField, doc, serverTimestamp, writeBatch, type Firestore, type WriteBatch } from 'firebase/firestore'
import type { GuildRole } from '../../../src/security.ts'
import { GUILD_ID } from './fixtures.ts'

const at = (db: Firestore, path: string) => doc(db, `guilds/${GUILD_ID}/${path}`)

/**
 * Mirrors approveJoinRequest in src/guildApi.ts: create the members doc, link the roster character if
 * one was chosen, and mark the request approved, all in one atomic batch.
 */
export function approveJoinRequestBatch(
  db: Firestore,
  request: { userId: string; email: string; displayName: string },
  role: GuildRole,
  playerId: string | null = null,
): WriteBatch {
  const batch = writeBatch(db)
  batch.set(at(db, `members/${request.userId}`), {
    email: request.email,
    displayName: request.displayName,
    role,
    playerId,
    joinedAt: serverTimestamp(),
  })
  if (playerId) batch.update(at(db, `roster/${playerId}`), { linkedUid: request.userId })
  batch.update(at(db, `joinRequests/${request.userId}`), { status: 'approved', assignedRole: role, linkedPlayerId: playerId })
  return batch
}

/**
 * Mirrors updateMembershipAccess in src/guildApi.ts: change a member's role and linked roster
 * character, releasing the previous character and claiming the new one in the same batch. The app
 * reads `previousPlayerId` from the members doc first; the test passes it in.
 */
export function updateMembershipAccessBatch(
  db: Firestore,
  uid: string,
  role: GuildRole,
  previousPlayerId: string | null,
  playerId: string | null,
): WriteBatch {
  const batch = writeBatch(db)
  if (previousPlayerId && previousPlayerId !== playerId) batch.update(at(db, `roster/${previousPlayerId}`), { linkedUid: deleteField() })
  if (playerId && previousPlayerId !== playerId) batch.update(at(db, `roster/${playerId}`), { linkedUid: uid })
  batch.update(at(db, `members/${uid}`), { role, playerId })
  return batch
}
