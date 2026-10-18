// The colors of the zones, guilds/<guildId>/settings/zoneColors: every guild member may read the document, only a Guild Leader may write it, and it has exactly
// `colors` (a map from a zone's key to a color, at most 200), `updatedBy` and `updatedAt` (stamped by the rules). It is a document of its own, so a save of
// the general settings does not touch it. The rules cannot look at each key and value of the map; the app reads them safely (see zoneColors.ts).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, deleteField, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { ANY_ROLE, LABEL, LEADER_ONLY, SIGNED_IN, UID, type Persona } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, resetData, setUpGuildEmulator, stored } from './support/harness.ts'

setUpGuildEmulator()

const doc = (db: ReturnType<typeof dbFor>) => guildDoc(db, 'settings/zoneColors')
const stamps = (who: Persona) => ({ updatedBy: UID[who as keyof typeof UID] ?? 'uid-nobody', updatedAt: serverTimestamp() })
const write = (who: Persona, colors: unknown, extra: Record<string, unknown> = {}) => setDoc(doc(dbFor(who)), { colors, ...stamps(who), ...extra })
const merge = (who: Persona, colors: Record<string, unknown>) => setDoc(doc(dbFor(who)), { colors, ...stamps(who) }, { merge: true })
const seed = (colors: Record<string, string> = { 719: '#278794' }) => asAdmin((db) => setDoc(doc(db), { colors, updatedBy: 'uid-earlier-editor', updatedAt: new Date('2026-12-01T00:00:00Z') }))
const many = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [String(50_000_000 + index), '#112233']))
const nonWriters = (['anonymous', ...SIGNED_IN] as Persona[]).filter((who) => !LEADER_ONLY.includes(who))

describe('reading the zone colors', () => {
  for (const who of ANY_ROLE) {
    test(`a ${LABEL[who]} can read them`, async () => {
      await seed()
      await expectAllowed(getDoc(doc(dbFor(who))))
    })
  }
  for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
    test(`a ${LABEL[who]} cannot read them`, async () => {
      await seed()
      await expectDenied(getDoc(doc(dbFor(who))))
    })
  }
})

describe('writing the zone colors', () => {
  for (const who of LEADER_ONLY) {
    test(`a ${LABEL[who]} can create the document, add and change a color, and take one away`, async () => {
      await expectAllowed(write(who, { 719: '#278794' }), 'creating it')
      assert.deepEqual((await stored('settings/zoneColors'))?.colors, { 719: '#278794' })
      assert.equal((await stored('settings/zoneColors'))?.updatedBy, UID[who as keyof typeof UID])
      await expectAllowed(merge(who, { 1581: '#957828' }), 'adding a zone by merging')
      await expectAllowed(merge(who, { 719: '#112233' }), 'changing a zone by merging')
      assert.deepEqual((await stored('settings/zoneColors'))?.colors, { 719: '#112233', 1581: '#957828' })
      await expectAllowed(setDoc(doc(dbFor(who)), { colors: { 719: deleteField() }, ...stamps(who) }, { merge: true }), 'taking a color away by merging')
      assert.deepEqual((await stored('settings/zoneColors'))?.colors, { 1581: '#957828' })
      await expectAllowed(updateDoc(doc(dbFor(who)), { 'colors.1581': deleteField(), ...stamps(who) }), 'taking the last away with an update')
      assert.deepEqual((await stored('settings/zoneColors'))?.colors, {})
    })
  }
  for (const who of nonWriters) {
    test(`a ${LABEL[who]} cannot write them, new or existing`, async () => {
      await expectDenied(write(who, { 719: '#278794' }), 'creating')
      await seed()
      await expectDenied(write(who, { 719: '#000000' }), 'replacing')
      await expectDenied(merge(who, { 1581: '#000000' }), 'merging')
      assert.deepEqual((await stored('settings/zoneColors'))?.colors, { 719: '#278794' })
    })
  }
  test('nobody can delete it', async () => {
    await seed()
    for (const who of ['member', 'raidLeader', 'guildLeader', 'stranger', 'anonymous'] as const) await expectDenied(deleteDoc(doc(dbFor(who))), who)
    assert.ok(await stored('settings/zoneColors'))
  })
})

describe('what the zone colors document has to look like', () => {
  const leader = 'guildLeader' as const

  test('an empty map and a map of exactly 200 colors are accepted, 201 is refused', async () => {
    await expectAllowed(write(leader, {}), 'empty')
    await expectAllowed(write(leader, many(200)), '200')
    await expectDenied(write(leader, many(201)), '201')
    assert.equal(Object.keys((await stored('settings/zoneColors'))?.colors ?? {}).length, 200)
  })

  test('colors has to be a map', async () => {
    for (const colors of [['#112233'], '#112233', 5, true, null]) await expectDenied(write(leader, colors), JSON.stringify(colors))
  })

  test('nothing but colors, updatedBy and updatedAt is accepted, and none of the three can be left out', async () => {
    await expectDenied(write(leader, {}, { extra: 1 }), 'an unknown field')
    await expectDenied(write(leader, {}, { phaseHistory: ['x'] }), 'a field of the general settings')
    await expectDenied(setDoc(doc(dbFor(leader)), { updatedBy: UID.guildLeader, updatedAt: serverTimestamp() }), 'no colors')
    await expectDenied(setDoc(doc(dbFor(leader)), { colors: {}, updatedAt: serverTimestamp() }), 'no updatedBy')
    await expectDenied(setDoc(doc(dbFor(leader)), { colors: {}, updatedBy: UID.guildLeader }), 'no updatedAt')
  })

  test('the stamps are the rules\' own: the writer and the server time', async () => {
    await expectDenied(write(leader, {}, { updatedBy: UID.raidLeader }), 'someone else as the writer')
    await expectDenied(write(leader, {}, { updatedBy: 5 }), 'a writer that is not text')
    await expectDenied(write(leader, {}, { updatedAt: new Date('2026-01-01T00:00:00Z') }), 'a time from the client')
    await expectDenied(write(leader, {}, { updatedAt: 'now' }), 'a time that is text')
    await expectAllowed(write(leader, {}), 'the honest write')
  })

  test('the first color of a guild can be written by merging, which is what the app does; a merge that only takes a color away from a document that is not there is refused (the app never sends one)', async () => {
    await expectAllowed(merge(leader, { 719: '#278794' }), 'the first color, by merging')
    assert.deepEqual((await stored('settings/zoneColors'))?.colors, { 719: '#278794' })
    await resetData()
    await expectDenied(setDoc(doc(dbFor(leader)), { colors: { 719: deleteField() }, ...stamps(leader) }, { merge: true }), 'a delete-only merge into nothing')
    assert.equal(await stored('settings/zoneColors'), undefined)
  })

  test('the map is not checked entry by entry: odd keys and values are stored and ignored by the app (a known limit of the rules language)', async () => {
    await expectAllowed(write(leader, { x: 'red', 719: 7, '-1': null }))
  })

  test('a save of the general settings does not touch the colors, and the general settings still refuse a zoneColors field', async () => {
    await seed()
    const general = { currentPhase: 'Launch prep', nextPhase: 'Phase one', currentStatusLabel: 'Preparing', currentStatusTone: 'preparing', nextStatusLabel: 'Not started', nextStatusTone: 'paused', councilStatus: 'deliberating', teamNames: { blue: 'Blue', yellow: 'Yellow', red: 'Red', white: 'White' }, groupNames: { green: 'Green', pink: 'Pink', brown: 'Brown' } }
    await expectAllowed(setDoc(guildDoc(dbFor(leader), 'settings/general'), general), 'saving the general settings')
    assert.deepEqual((await stored('settings/zoneColors'))?.colors, { 719: '#278794' })
    await expectDenied(setDoc(guildDoc(dbFor(leader), 'settings/general'), { ...general, zoneColors: { 719: '#112233' } }), 'colors in the general settings')
  })

  test('another settings document id is still refused', async () => {
    await expectDenied(setDoc(guildDoc(dbFor(leader), 'settings/other'), { colors: {}, ...stamps(leader) }))
    await expectDenied(setDoc(guildDoc(dbFor(leader), 'settings/zonecolors'), { colors: {}, ...stamps(leader) }), 'a different case')
  })
})
