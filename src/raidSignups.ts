import { collection, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions, guildId } from './firebase'

export const signupStatuses = ['accept', 'tentative', 'absent', 'late', 'bench'] as const
export type SignupStatus = typeof signupStatuses[number]
export type RaidSignup = { id: string; characterId: string; status: SignupStatus; benchKind?: 'self' }
export const signupLabels: Record<SignupStatus, string> = {
  accept: 'Accept', tentative: 'Tentative', absent: 'Absent', late: 'Late', bench: 'Bench (voluntary)',
}

function signupsCollection(raidId: string) {
  if (!db || !guildId) throw new Error('Firebase is not configured for this guild.')
  return collection(db, 'guilds', guildId, 'raids', raidId, 'signups')
}

export function subscribeRaidSignups(raidId: string, onData: (signups: RaidSignup[]) => void, onError: (error: Error) => void) {
  return onSnapshot(signupsCollection(raidId), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.hasPendingWrites) return
    const signups: RaidSignup[] = []
    for (const record of snapshot.docs) {
      const data = record.data()
      if (typeof data.characterId !== 'string' || !signupStatuses.includes(data.status)
        || (data.status === 'bench' ? data.benchKind !== 'self' : data.benchKind !== undefined)) {
        onError(new Error('A raid sign-up could not be read. Ask a Guild Leader to check the record.'))
        return
      }
      signups.push({ id: record.id, characterId: data.characterId, status: data.status, ...(data.benchKind ? { benchKind: data.benchKind } : {}) })
    }
    onData(signups)
  }, onError)
}

export async function saveRaidSignup(raidId: string, uid: string, characterId: string, status: SignupStatus) {
  if (!functions || !auth?.currentUser || uid !== auth.currentUser.uid || !characterId) throw new Error('Sign in and choose one of your linked characters.')
  await httpsCallable(functions, 'saveRaidResponse')({ guildId, raidId, characterId, status })
}
