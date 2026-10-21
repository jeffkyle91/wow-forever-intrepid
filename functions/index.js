import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onCall } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { addAbsence, removeAbsence, saveResponse, synchronizeGuild, synchronizeMember, synchronizeRaid } from './raids.js'
import { submitCharacterRequest as submitCharacterChange, resolveCharacterRequest as resolveCharacterChange } from './characters.js'
import { changePlacement, createScheduledRaid as createRaid, initializePlanning, synchronizePlanning, synchronizePlanningGuild } from './raidPlanning.js'
import { runRaidStartSnapshotSweep } from './raidStartSnapshot.js'
import { changeStandingTeam } from './standingTeams.js'

initializeApp()
const db = getFirestore()
const options = { region: 'us-central1', maxInstances: 5 }

export const createScheduledRaid = onCall(options, (request) => createRaid(db, request))
export const changeStandingTeamAssignment = onCall(options, (request) => changeStandingTeam(db, request))
export const initializeScheduledRoster = onCall(options, (request) => initializePlanning(db, request))
export const changeScheduledPlacement = onCall(options, (request) => changePlacement(db, request))
export const submitCharacterRequest = onCall(options, (request) => submitCharacterChange(db, request))
export const resolveCharacterRequest = onCall(options, (request) => resolveCharacterChange(db, request))
export const saveRaidResponse = onCall(options, (request) => saveResponse(db, request))
export const addUnavailableDates = onCall(options, (request) => addAbsence(db, request))
export const removeUnavailableDates = onCall(options, (request) => removeAbsence(db, request))
export const synchronizeRaidAbsences = onCall({ ...options, timeoutSeconds: 540 }, (request) => synchronizeGuild(db, request))
export const captureRaidStartSnapshots = onSchedule({
  ...options, schedule: '0 21 * * *', timeZone: 'America/New_York', timeoutSeconds: 540, retryCount: 3,
}, () => runRaidStartSnapshotSweep(db))
export const synchronizeScheduledRaid = onDocumentWritten({
  ...options, document: 'guilds/{guildId}/raids/{raidId}', retry: true,
}, async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!after || (before && before.date === after.date && before.status === after.status && before.size === after.size
    && JSON.stringify(before.zones) === JSON.stringify(after.zones) && before.startsAt?.isEqual(after.startsAt))) return
  await synchronizeRaid(db, event.params.guildId, event.params.raidId)
  await synchronizePlanning(db, event.params.guildId, event.params.raidId)
})

export const synchronizeLinkedMember = onDocumentWritten({
  ...options, document: 'guilds/{guildId}/members/{uid}', retry: true,
}, async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!after?.playerId || before?.playerId === after.playerId) return
  await synchronizeMember(db, event.params.guildId, event.params.uid)
})

export const synchronizeRaidInvitationsFromReadiness = onDocumentWritten({
  ...options, document: 'guilds/{guildId}/characterReadiness/{characterId}', retry: true,
}, (event) => synchronizePlanningGuild(db, event.params.guildId))

export const synchronizeRaidInvitationsFromRoster = onDocumentWritten({
  ...options, document: 'guilds/{guildId}/roster/{characterId}', retry: true,
}, (event) => synchronizePlanningGuild(db, event.params.guildId))

export const synchronizeRaidInvitationsFromMembership = onDocumentWritten({
  ...options, document: 'guilds/{guildId}/members/{uid}', retry: true,
}, (event) => synchronizePlanningGuild(db, event.params.guildId))
