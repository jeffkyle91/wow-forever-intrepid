import { beforeEach, describe, test } from 'node:test'
import { collection, deleteDoc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { ANY_ROLE, GUILD_ID, UID } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()

const manifestPath = 'raids/planned/snapshots/start'

beforeEach(() => asAdmin(async (db) => {
  await setDoc(guildDoc(db, manifestPath), {
    schemaVersion: 1, status: 'complete', raidId: 'planned',
    scheduledStartAt: new Date('2026-10-20T00:00:00Z'),
  })
  await setDoc(guildDoc(db, `${manifestPath}/lineups/10`), { size: 10, teams: [], bench: [] })
  await setDoc(guildDoc(db, `${manifestPath}/characters/player-1`), { id: 'player-1', name: 'Invented Raider' })
  await setDoc(guildDoc(db, `${manifestPath}/accounts/${UID.member}`), { uid: UID.member, displayName: 'Invented Member' })
}))

describe('immutable scheduled raid start snapshots', () => {
  for (const who of ANY_ROLE) {
    test(`${who} can read only published snapshot documents and cannot write them`, async () => {
      const db = dbFor(who)
      const manifest = guildDoc(db, manifestPath)
      await expectAllowed(getDoc(manifest))
      await expectAllowed(getDocs(query(
        collection(db, 'guilds', GUILD_ID, 'raids', 'planned', 'snapshots'),
        where('status', '==', 'complete'),
      )))
      await expectAllowed(getDocs(collection(db, 'guilds', GUILD_ID, `${manifestPath}/accounts`)))
      for (const path of [
        `${manifestPath}/lineups/10`,
        `${manifestPath}/characters/player-1`,
        `${manifestPath}/accounts/${UID.member}`,
      ]) await expectAllowed(getDoc(guildDoc(db, path)))

      await expectDenied(setDoc(guildDoc(db, 'raids/planned/snapshots/forged'), { status: 'complete' }))
      await expectDenied(updateDoc(manifest, { status: 'failed' }))
      await expectDenied(deleteDoc(manifest))
      await expectDenied(setDoc(guildDoc(db, `${manifestPath}/characters/forged`), { name: 'Forged Raider' }))
      await expectDenied(updateDoc(guildDoc(db, `${manifestPath}/accounts/${UID.member}`), { displayName: 'Changed' }))
      await expectDenied(deleteDoc(guildDoc(db, `${manifestPath}/lineups/10`)))
    })
  }

  test('anonymous, outsiders, removed members and other-guild leaders cannot read snapshots', async () => {
    for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
      await expectDenied(getDoc(guildDoc(dbFor(who), manifestPath)))
      await expectDenied(getDoc(guildDoc(dbFor(who), `${manifestPath}/characters/player-1`)))
      await expectDenied(getDocs(query(
        collection(dbFor(who), 'guilds', GUILD_ID, 'raids', 'planned', 'snapshots'),
        where('status', '==', 'complete'),
      )))
    }
    await asAdmin((db) => updateDoc(guildDoc(db, `members/${UID.member}`), { role: 'Removed' }))
    await expectDenied(getDoc(guildDoc(dbFor('member'), manifestPath)))
    await expectDenied(getDoc(guildDoc(dbFor('member'), `${manifestPath}/accounts/${UID.member}`)))
  })

  test('capturing manifests and their child records are not visible before publication', async () => {
    await asAdmin((db) => updateDoc(guildDoc(db, manifestPath), { status: 'capturing' }))
    for (const who of ANY_ROLE) {
      await expectDenied(getDoc(guildDoc(dbFor(who), manifestPath)))
      await expectDenied(getDoc(guildDoc(dbFor(who), `${manifestPath}/lineups/10`)))
      await expectDenied(getDoc(guildDoc(dbFor(who), `${manifestPath}/characters/player-1`)))
      await expectDenied(getDoc(guildDoc(dbFor(who), `${manifestPath}/accounts/${UID.member}`)))
      await expectAllowed(getDocs(query(
        collection(dbFor(who), 'guilds', GUILD_ID, 'raids', 'planned', 'snapshots'),
        where('status', '==', 'complete'),
      )))
      await expectDenied(getDocs(collection(dbFor(who), 'guilds', GUILD_ID, `${manifestPath}/lineups`)))
    }
  })

  test('server-side capture failure records are not exposed through client rules', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'raidSnapshotFailures/failure-record'), {
      raidId: 'planned', code: 'missing-working-roster', message: 'Internal diagnostic',
    }))
    for (const who of ANY_ROLE) await expectDenied(getDoc(guildDoc(dbFor(who), 'raidSnapshotFailures/failure-record')))
  })
})
