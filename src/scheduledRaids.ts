import { doc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions, guildId } from './firebase'
import { readScheduledRoster, type ScheduledRoster } from './shared/raids/planning'
import type { RaidSize } from './guildApi'

export function subscribeScheduledRoster(raidId: string, onData: (roster: ScheduledRoster | null) => void, onError: (error: Error) => void) {
  if (!db || !guildId) throw new Error('Firebase is not configured for this guild.')
  return onSnapshot(doc(db, 'guilds', guildId, 'raids', raidId, 'planning', 'working'), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.hasPendingWrites) return
    if (!snapshot.exists()) { onData(null); return }
    const roster = readScheduledRoster(snapshot.data())
    if (!roster) {
      onError(new Error('The scheduled working roster could not be read. Ask a Guild Leader to check the record.'))
      return
    }
    onData(roster)
  }, onError)
}

export async function initializeScheduledRoster(raidId: string) {
  if (!functions || !auth?.currentUser) throw new Error('Sign in to initialize a scheduled roster.')
  await httpsCallable(functions, 'initializeScheduledRoster')({ guildId, raidId })
}

export async function changeScheduledPlacement(raidId: string, size: RaidSize, characterId: string, destination: string, revision: number, acknowledgeAbsence: boolean) {
  if (!functions || !auth?.currentUser) throw new Error('Sign in to change a scheduled roster.')
  await httpsCallable(functions, 'changeScheduledPlacement')({ guildId, raidId, size, characterId, destination, revision, acknowledgeAbsence })
}
