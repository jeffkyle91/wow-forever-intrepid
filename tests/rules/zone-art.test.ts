// The zone artwork, guilds/<guildId>/settings/zoneArt: every guild member may read the document, only a Guild Leader may write it, and it has exactly `images` (the
// pictures a leader uploaded to Cloud Storage, a map from a picture's id, at most 200), `art` (which picture each zone uses, a map from a zone's key to a picture's id, at
// most 200), `updatedBy` and `updatedAt` (stamped by the rules). It is a document of its own, so a save of the general settings or the colors does not touch it. The
// rules cannot look at each entry of a map; the app reads them safely (see zoneArt.ts). The files are in storage.rules and are tested in zone-art-storage.test.ts.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, deleteField, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { ANY_ROLE, LABEL, LEADER_ONLY, SIGNED_IN, UID, type Persona } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, resetData, setUpGuildEmulator, stored } from './support/harness.ts'

setUpGuildEmulator()

const doc = (db: ReturnType<typeof dbFor>) => guildDoc(db, 'settings/zoneArt')
const stamps = (who: Persona) => ({ updatedBy: UID[who as keyof typeof UID] ?? 'uid-nobody', updatedAt: serverTimestamp() })
const image = (name = 'Molten Core', rev = 1) => ({ name, rev, bytes: 157_732, width: 1920, height: 1080, full: 'guilds/guild-test/zone-art/abc123xyz/full-1.jpg', fullUrl: 'https://firebasestorage.googleapis.com/v0/b/demo/o/full', thumb: 'guilds/guild-test/zone-art/abc123xyz/thumb-1.jpg', thumbUrl: 'https://firebasestorage.googleapis.com/v0/b/demo/o/thumb' })
const write = (who: Persona, images: unknown, art: unknown, extra: Record<string, unknown> = {}) => setDoc(doc(dbFor(who)), { images, art, ...stamps(who), ...extra })
const merge = (who: Persona, data: { images?: Record<string, unknown>; art?: Record<string, unknown> }) => setDoc(doc(dbFor(who)), { ...data, ...stamps(who) }, { merge: true })
const seed = (images: Record<string, unknown> = { abc123xyz: image() }, art: Record<string, string> = { 719: 'abc123xyz' }) => asAdmin((db) => setDoc(doc(db), { images, art, updatedBy: 'uid-earlier-editor', updatedAt: new Date('2026-12-01T00:00:00Z') }))
const many = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`img${String(index).padStart(5, '0')}`, image(`Picture ${index}`)]))
const manyZones = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [String(50_000_000 + index), 'abc123xyz']))
const nonWriters = (['anonymous', ...SIGNED_IN] as Persona[]).filter((who) => !LEADER_ONLY.includes(who))

describe('reading the zone artwork', () => {
  for (const who of ANY_ROLE) {
    test(`a ${LABEL[who]} can read it`, async () => {
      await seed()
      await expectAllowed(getDoc(doc(dbFor(who))))
    })
  }
  for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
    test(`a ${LABEL[who]} cannot read it`, async () => {
      await seed()
      await expectDenied(getDoc(doc(dbFor(who))))
    })
  }
})

describe('writing the zone artwork', () => {
  for (const who of LEADER_ONLY) {
    test(`a ${LABEL[who]} can create the document, add and replace a picture, pick one for a zone, and take both away`, async () => {
      await expectAllowed(write(who, { abc123xyz: image() }, {}), 'creating it with a picture and no zone')
      await expectAllowed(merge(who, { art: { 719: 'abc123xyz' } }), 'picking the picture for a zone by merging')
      await expectAllowed(merge(who, { images: { def456uvw: image('Onyxia\'s Lair') } }), 'adding a picture by merging')
      await expectAllowed(merge(who, { images: { abc123xyz: image('Molten Core', 2) } }), 'replacing a picture by merging')
      const now = await stored('settings/zoneArt')
      assert.deepEqual(Object.keys(now?.images ?? {}).sort(), ['abc123xyz', 'def456uvw'])
      assert.equal(now?.images.abc123xyz.rev, 2)
      assert.deepEqual(now?.art, { 719: 'abc123xyz' })
      assert.equal(now?.updatedBy, UID[who as keyof typeof UID])
      await expectAllowed(setDoc(doc(dbFor(who)), { images: { abc123xyz: deleteField() }, art: { 719: deleteField() }, ...stamps(who) }, { merge: true }), 'removing a picture and its zone together')
      assert.deepEqual(Object.keys((await stored('settings/zoneArt'))?.images ?? {}), ['def456uvw'])
      assert.deepEqual((await stored('settings/zoneArt'))?.art, {})
      await expectAllowed(updateDoc(doc(dbFor(who)), { 'images.def456uvw': deleteField(), ...stamps(who) }), 'taking the last picture away with an update')
      assert.deepEqual((await stored('settings/zoneArt'))?.images, {})
    })
  }
  for (const who of nonWriters) {
    test(`a ${LABEL[who]} cannot write it, new or existing`, async () => {
      await expectDenied(write(who, { abc123xyz: image() }, { 719: 'abc123xyz' }), 'creating')
      await seed()
      await expectDenied(write(who, {}, {}), 'replacing')
      await expectDenied(merge(who, { art: { 1581: 'abc123xyz' } }), 'merging')
      assert.deepEqual((await stored('settings/zoneArt'))?.art, { 719: 'abc123xyz' })
    })
  }
  test('nobody can delete it', async () => {
    await seed()
    for (const who of ['member', 'raidLeader', 'guildLeader', 'stranger', 'anonymous'] as const) await expectDenied(deleteDoc(doc(dbFor(who))), who)
    assert.ok(await stored('settings/zoneArt'))
  })
})

describe('what the zone artwork document has to look like', () => {
  const leader = 'guildLeader' as const

  test('empty maps are accepted; 200 pictures and 200 zones are accepted, 201 of either is refused', async () => {
    await expectAllowed(write(leader, {}, {}), 'empty')
    await expectAllowed(write(leader, many(200), manyZones(200)), '200 and 200')
    await expectDenied(write(leader, many(201), {}), '201 pictures')
    await expectDenied(write(leader, {}, manyZones(201)), '201 zones')
    assert.equal(Object.keys((await stored('settings/zoneArt'))?.images ?? {}).length, 200)
  })

  test('images and art have to be maps', async () => {
    for (const bad of [['x'], 'x', 5, true, null]) {
      await expectDenied(write(leader, bad, {}), `images ${JSON.stringify(bad)}`)
      await expectDenied(write(leader, {}, bad), `art ${JSON.stringify(bad)}`)
    }
  })

  test('nothing but images, art, updatedBy and updatedAt is accepted, and none of the four can be left out', async () => {
    await expectDenied(write(leader, {}, {}, { extra: 1 }), 'an unknown field')
    await expectDenied(write(leader, {}, {}, { colors: {} }), 'a field of the colors')
    await expectDenied(write(leader, {}, {}, { phaseHistory: ['x'] }), 'a field of the general settings')
    await expectDenied(setDoc(doc(dbFor(leader)), { art: {}, ...stamps(leader) }), 'no images')
    await expectDenied(setDoc(doc(dbFor(leader)), { images: {}, ...stamps(leader) }), 'no art')
    await expectDenied(setDoc(doc(dbFor(leader)), { images: {}, art: {}, updatedAt: serverTimestamp() }), 'no updatedBy')
    await expectDenied(setDoc(doc(dbFor(leader)), { images: {}, art: {}, updatedBy: UID.guildLeader }), 'no updatedAt')
  })

  test('the stamps are the rules\' own: the writer and the server time', async () => {
    await expectDenied(write(leader, {}, {}, { updatedBy: UID.raidLeader }), 'someone else as the writer')
    await expectDenied(write(leader, {}, {}, { updatedBy: 5 }), 'a writer that is not text')
    await expectDenied(write(leader, {}, {}, { updatedAt: new Date('2026-01-01T00:00:00Z') }), 'a time from the client')
    await expectDenied(write(leader, {}, {}, { updatedAt: 'now' }), 'a time that is text')
    await expectAllowed(write(leader, {}, {}), 'the honest write')
  })

  test('the first picture of a guild can be added by merging, which is what the app does, as long as both maps end up in the document', async () => {
    await expectAllowed(setDoc(doc(dbFor(leader)), { images: { abc123xyz: image() }, art: {}, ...stamps(leader) }, { merge: true }), 'the first picture, by merging')
    assert.deepEqual(Object.keys((await stored('settings/zoneArt'))?.images ?? {}), ['abc123xyz'])
    await resetData()
    await expectDenied(merge(leader, { images: { abc123xyz: image() } }), 'a merge into nothing that leaves out art')
    assert.equal(await stored('settings/zoneArt'), undefined)
  })

  test('the maps are not checked entry by entry: odd keys and values are stored and ignored by the app (a known limit of the rules language)', async () => {
    await expectAllowed(write(leader, { x: 'red', abc123xyz: 7 }, { 719: 7, '-1': null }))
  })

  test('a save of the general settings does not touch the artwork, and the general settings still refuse a zoneArt field', async () => {
    await seed()
    const general = { currentPhase: 'Launch prep', nextPhase: 'Phase one', currentStatusLabel: 'Preparing', currentStatusTone: 'preparing', nextStatusLabel: 'Not started', nextStatusTone: 'paused', councilStatus: 'deliberating', teamNames: { blue: 'Blue', yellow: 'Yellow', red: 'Red', white: 'White' }, groupNames: { green: 'Green', pink: 'Pink', brown: 'Brown' } }
    await expectAllowed(setDoc(guildDoc(dbFor(leader), 'settings/general'), general), 'saving the general settings')
    assert.deepEqual((await stored('settings/zoneArt'))?.art, { 719: 'abc123xyz' })
    await expectDenied(setDoc(guildDoc(dbFor(leader), 'settings/general'), { ...general, zoneArt: { 719: 'abc123xyz' } }), 'artwork in the general settings')
  })

  test('another settings document id is still refused', async () => {
    await expectDenied(setDoc(guildDoc(dbFor(leader), 'settings/other'), { images: {}, art: {}, ...stamps(leader) }))
    await expectDenied(setDoc(guildDoc(dbFor(leader), 'settings/zoneart'), { images: {}, art: {}, ...stamps(leader) }), 'a different case')
  })

  test('the colors document still refuses the artwork fields, and the artwork document refuses colors', async () => {
    await expectDenied(setDoc(guildDoc(dbFor(leader), 'settings/zoneColors'), { colors: {}, images: {}, ...stamps(leader) }), 'images in the colors')
    await expectDenied(write(leader, {}, {}, { colors: { 719: '#278794' } }), 'colors in the artwork')
  })
})
