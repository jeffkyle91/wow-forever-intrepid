// The guild settings document, guilds/<guildId>/settings/general: every guild member may read it, only a
// Guild Leader may write it, and the write must have exactly the expected fields.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, getDoc, setDoc } from 'firebase/firestore'
import { ANY_ROLE, LABEL, LEADER_ONLY, SIGNED_IN, without, type Persona } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, setUpGuildEmulator, stored } from './support/harness.ts'

setUpGuildEmulator()

const validSettings = () => ({
  currentPhase: 'Launch prep',
  nextPhase: 'Phase one',
  currentStatusLabel: 'Preparing',
  currentStatusTone: 'preparing',
  nextStatusLabel: 'Not started',
  nextStatusTone: 'paused',
  councilStatus: 'deliberating',
  teamNames: { blue: 'Blue', yellow: 'Yellow', red: 'Red', white: 'White' },
  groupNames: { green: 'Green', pink: 'Pink', brown: 'Brown' },
})

const save = (who: Persona, data: Record<string, unknown>, id = 'general') => setDoc(guildDoc(dbFor(who), `settings/${id}`), data)
const writers = LEADER_ONLY
const nonWriters = (['anonymous', ...SIGNED_IN] as Persona[]).filter((who) => !writers.includes(who))

describe('reading the guild settings', () => {
  for (const who of ANY_ROLE) {
    test(`a ${LABEL[who]} can read them`, async () => {
      await asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), validSettings()))
      await expectAllowed(getDoc(guildDoc(dbFor(who), 'settings/general')))
    })
  }

  for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
    test(`a ${LABEL[who]} cannot read them`, async () => {
      await expectDenied(getDoc(guildDoc(dbFor(who), 'settings/general')))
    })
  }
})

describe('writing the guild settings', () => {
  for (const who of writers) {
    test(`a ${LABEL[who]} can save valid settings, creating and then updating`, async () => {
      await expectAllowed(save(who, validSettings()), 'creating the settings')
      await expectAllowed(save(who, { ...validSettings(), councilStatus: 'live' }), 'updating the settings')
      assert.equal((await stored('settings/general'))?.councilStatus, 'live')
    })
  }

  for (const who of nonWriters) {
    test(`a ${LABEL[who]} cannot write them`, async () => {
      await expectDenied(save(who, validSettings()))
    })
  }

  for (const who of (['member', 'raidLeader'] as const)) {
    test(`a ${LABEL[who]} cannot change existing settings`, async () => {
      await asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), validSettings()))
      await expectDenied(save(who, { ...validSettings(), nextPhase: 'Changed' }))
      assert.equal((await stored('settings/general'))?.nextPhase, 'Phase one')
    })
  }

  test('only the document named general can be written', async () => {
    await expectDenied(save('guildLeader', validSettings(), 'other'))
  })

  test('the settings can never be deleted', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), validSettings()))
    await expectDenied(deleteDoc(guildDoc(dbFor('guildLeader'), 'settings/general')))
  })
})

describe('what a settings document must contain', () => {
  const leader = (data: Record<string, unknown>) => save('guildLeader', data)

  for (const field of ['currentPhase', 'nextPhase', 'currentStatusLabel', 'currentStatusTone', 'nextStatusLabel', 'nextStatusTone', 'councilStatus', 'teamNames', 'groupNames']) {
    test(`a document without ${field} is refused`, async () => {
      await expectDenied(leader(without(validSettings(), field)))
    })
  }

  test('an extra field is refused', async () => {
    await expectDenied(leader({ ...validSettings(), note: 'hello' }))
  })

  for (const field of ['currentPhase', 'nextPhase', 'currentStatusLabel', 'nextStatusLabel']) {
    test(`${field} must be 1 to 40 characters of text`, async () => {
      await expectAllowed(leader({ ...validSettings(), [field]: 'x'.repeat(40) }), '40 characters')
      await expectDenied(leader({ ...validSettings(), [field]: '' }), 'empty text')
      await expectDenied(leader({ ...validSettings(), [field]: 'x'.repeat(41) }), '41 characters')
      await expectDenied(leader({ ...validSettings(), [field]: 5 }), 'a number')
    })
  }

  for (const field of ['currentStatusTone', 'nextStatusTone']) {
    test(`the ${field} indicator must be active, preparing or paused`, async () => {
      for (const tone of ['active', 'preparing', 'paused']) await expectAllowed(leader({ ...validSettings(), [field]: tone }), tone)
      await expectDenied(leader({ ...validSettings(), [field]: 'broken' }))
    })
  }

  test('the council status must be deliberating or live', async () => {
    for (const councilStatus of ['deliberating', 'live']) await expectAllowed(leader({ ...validSettings(), councilStatus }), councilStatus)
    for (const councilStatus of ['open', 'closed', 'Live', 5]) await expectDenied(leader({ ...validSettings(), councilStatus }), String(councilStatus))
  })

  test('team names need all four teams and nothing else', async () => {
    const { blue, yellow, red } = validSettings().teamNames
    await expectDenied(leader({ ...validSettings(), teamNames: { blue, yellow, red } }), 'a missing team')
    await expectDenied(leader({ ...validSettings(), teamNames: { ...validSettings().teamNames, brown: 'Brown' } }), 'an extra team')
    await expectDenied(leader({ ...validSettings(), teamNames: 'Blue' }), 'text instead of a map')
  })

  test('group names need green, pink and brown and nothing else', async () => {
    const { green, pink } = validSettings().groupNames
    await expectDenied(leader({ ...validSettings(), groupNames: { green, pink } }), 'a missing group')
    await expectDenied(leader({ ...validSettings(), groupNames: { ...validSettings().groupNames, blue: 'Blue' } }), 'an extra group')
    await expectDenied(leader({ ...validSettings(), groupNames: 'Green' }), 'text instead of a map')
  })

  for (const group of ['green', 'pink', 'brown']) {
    test(`the ${group} group name must be 1 to 40 characters of text`, async () => {
      const withName = (name: unknown) => leader({ ...validSettings(), groupNames: { ...validSettings().groupNames, [group]: name } })
      await expectAllowed(withName('Renamed'))
      await expectDenied(withName(''), 'empty text')
      await expectDenied(withName('x'.repeat(41)), '41 characters')
      await expectDenied(withName(5), 'a number')
    })
  }

  for (const team of ['blue', 'yellow', 'red', 'white']) {
    test(`the ${team} team name must be 1 to 40 characters of text`, async () => {
      const withName = (name: unknown) => leader({ ...validSettings(), teamNames: { ...validSettings().teamNames, [team]: name } })
      await expectAllowed(withName('Renamed'))
      await expectDenied(withName(''), 'empty text')
      await expectDenied(withName('x'.repeat(41)), '41 characters')
      await expectDenied(withName(5), 'a number')
    })
  }
})
