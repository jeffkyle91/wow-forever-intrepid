import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onCall } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { addAbsence, removeAbsence, saveResponse, synchronizeGuild, synchronizeMember, synchronizeRaid } from './raids.js'

initializeApp()
const db = getFirestore()
const options = { region: 'us-central1', maxInstances: 5 }

export const saveRaidResponse = onCall(options, (request) => saveResponse(db, request))
export const addUnavailableDates = onCall(options, (request) => addAbsence(db, request))
export const removeUnavailableDates = onCall(options, (request) => removeAbsence(db, request))
export const synchronizeRaidAbsences = onCall({ ...options, timeoutSeconds: 540 }, (request) => synchronizeGuild(db, request))
export const synchronizeScheduledRaid = onDocumentWritten({
  ...options, document: 'guilds/{guildId}/raids/{raidId}', retry: true,
}, async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!after || (before && before.date === after.date && before.status === after.status && before.startsAt?.isEqual(after.startsAt))) return
  await synchronizeRaid(db, event.params.guildId, event.params.raidId)
})

export const synchronizeLinkedMember = onDocumentWritten({
  ...options, document: 'guilds/{guildId}/members/{uid}', retry: true,
}, async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!after?.playerId || before?.playerId === after.playerId) return
  await synchronizeMember(db, event.params.guildId, event.params.uid)
})
