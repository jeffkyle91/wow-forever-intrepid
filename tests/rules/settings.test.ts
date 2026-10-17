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

// The loot phases: `phaseHistory` lists the finished phases, oldest first, and its length is the current phase's number. It can change in
// only two ways (a phase is started or the last one reopened), and each way has to keep the names truthful.
describe('the loot phase history', () => {
  const leader = (data: Record<string, unknown>) => save('guildLeader', data)
  const names = (count: number) => Array.from({ length: count }, (_, index) => `Phase ${index + 1}`)
  // The stored settings, as an earlier save left them.
  const stage = (current: string, history?: string[], next = 'Phase one') =>
    asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { ...validSettings(), currentPhase: current, nextPhase: next, ...(history ? { phaseHistory: history } : {}) }))
  const after = (change: Record<string, unknown>) => ({ ...validSettings(), ...change })

  test('settings without a history, and with an empty one, are accepted', async () => {
    await expectAllowed(leader(validSettings()), 'none')
    await expectAllowed(leader(after({ phaseHistory: [] })), 'an empty list')
  })

  test('a guild that never closed a phase can start one: the old current name goes on the end of the list', async () => {
    await stage('Launch prep')
    await expectAllowed(leader(after({ currentPhase: 'Phase one', nextPhase: 'To be announced', phaseHistory: ['Launch prep'] })))
    assert.deepEqual((await stored('settings/general'))?.phaseHistory, ['Launch prep'])
  })

  test('a second phase can be started the same way', async () => {
    await stage('Phase one', ['Launch prep'])
    await expectAllowed(leader(after({ currentPhase: 'Phase two', phaseHistory: ['Launch prep', 'Phase one'] })))
  })

  test('the list can grow to 30 names, and no further', async () => {
    await stage('Phase 30', names(29))
    await expectAllowed(leader(after({ currentPhase: 'Phase 31', phaseHistory: [...names(29), 'Phase 30'] })), 'the 30th name')
    await stage('Phase 31', names(30))
    await expectDenied(leader(after({ currentPhase: 'Phase 32', phaseHistory: [...names(30), 'Phase 31'] })), 'the 31st name')
  })

  test('starting a phase has to name the phase that was current', async () => {
    await stage('Launch prep')
    await expectDenied(leader(after({ currentPhase: 'Phase one', phaseHistory: ['Something else'] })), 'another name')
    await expectDenied(leader(after({ currentPhase: 'Phase one', phaseHistory: ['Phase one'] })), 'the new name')
  })

  test('starting two phases in one save is refused', async () => {
    await stage('Launch prep')
    await expectDenied(leader(after({ currentPhase: 'Phase two', phaseHistory: ['Launch prep', 'Phase one'] })))
  })

  test('starting a phase cannot change a name already in the list', async () => {
    await stage('Phase two', ['Launch prep', 'Phase one'])
    await expectDenied(leader(after({ currentPhase: 'Phase three', phaseHistory: ['Renamed', 'Phase one', 'Phase two'] })), 'an earlier name')
    await expectDenied(leader(after({ currentPhase: 'Phase three', phaseHistory: ['Phase one', 'Launch prep', 'Phase two'] })), 'a different order')
  })

  test('the first save of the settings can start a phase, closing the default current phase', async () => {
    await expectAllowed(leader(after({ currentPhase: 'Phase one', nextPhase: 'To be announced', phaseHistory: ['Launch prep'] })))
    assert.deepEqual((await stored('settings/general'))?.phaseHistory, ['Launch prep'])
  })

  test('the first save cannot close any other name, close more than one phase, or reopen one', async () => {
    await expectDenied(leader(after({ currentPhase: 'Phase one', phaseHistory: ['Something else'] })), 'another name')
    await expectDenied(leader(after({ currentPhase: 'Phase two', phaseHistory: ['Launch prep', 'Phase one'] })), 'two phases')
    await expectDenied(leader(after({ phaseHistory: 'Launch prep' })), 'text')
  })

  test('the last phase can be reopened: its name becomes current again and the name being left becomes the next phase', async () => {
    await stage('Phase one', ['Launch prep'], 'To be announced')
    await expectAllowed(leader(after({ currentPhase: 'Launch prep', nextPhase: 'Phase one' })), 'without the field')
    assert.equal((await stored('settings/general'))?.currentPhase, 'Launch prep')
    await stage('Phase two', ['Launch prep', 'Phase one'], 'To be announced')
    await expectAllowed(leader(after({ currentPhase: 'Phase one', nextPhase: 'Phase two', phaseHistory: ['Launch prep'] })), 'one name left')
  })

  test('reopening has to bring back the name that was last in the list, and name the phase being left as next', async () => {
    await stage('Phase two', ['Launch prep', 'Phase one'])
    await expectDenied(leader(after({ currentPhase: 'Launch prep', nextPhase: 'Phase two', phaseHistory: ['Launch prep'] })), 'the wrong phase brought back')
    await expectDenied(leader(after({ currentPhase: 'Phase one', nextPhase: 'Something else', phaseHistory: ['Launch prep'] })), 'the wrong next phase')
  })

  test('reopening two phases in one save is refused', async () => {
    await stage('Phase two', ['Launch prep', 'Phase one'])
    await expectDenied(leader(after({ currentPhase: 'Launch prep', nextPhase: 'Phase two' })))
  })

  test('reopening cannot change a name that stays in the list', async () => {
    await stage('Phase three', ['Launch prep', 'Phase one', 'Phase two'])
    await expectDenied(leader(after({ currentPhase: 'Phase two', nextPhase: 'Phase three', phaseHistory: ['Hacked', 'Phase one'] })), 'a changed earlier name')
    await expectDenied(leader(after({ currentPhase: 'Phase two', nextPhase: 'Phase three', phaseHistory: ['Phase one', 'Launch prep'] })), 'a reordered list')
    await expectAllowed(leader(after({ currentPhase: 'Phase two', nextPhase: 'Phase three', phaseHistory: ['Launch prep', 'Phase one'] })), 'the honest reopening')
  })

  test('the list cannot be replaced or reordered', async () => {
    await stage('Phase two', ['Launch prep', 'Phase one'])
    await expectDenied(leader(after({ currentPhase: 'Phase two', phaseHistory: ['Phase one', 'Launch prep'] })), 'reordered')
    await expectDenied(leader(after({ currentPhase: 'Phase two', phaseHistory: ['Other', 'Names'] })), 'other names')
    await expectDenied(leader(after({ currentPhase: 'Phase two', phaseHistory: [] })), 'emptied')
  })

  test('the list cannot be added to without starting a phase', async () => {
    await stage('Launch prep')
    await expectDenied(leader(after({ phaseHistory: ['Earlier phase'] })), 'with the current name unchanged')
  })

  test('saving the other settings leaves the list as it is, and the current phase can be renamed', async () => {
    await stage('Phase one', ['Launch prep'])
    await expectAllowed(leader(after({ currentPhase: 'Phase 1 (renamed)', councilStatus: 'live', phaseHistory: ['Launch prep'] })))
    assert.deepEqual((await stored('settings/general'))?.phaseHistory, ['Launch prep'])
  })

  test('a history that is not a list is refused', async () => {
    for (const phaseHistory of ['Launch prep', { 0: 'Launch prep' }, {}, 1, null]) await expectDenied(leader(after({ phaseHistory })), `first save: ${JSON.stringify(phaseHistory)}`)
    await stage('Launch prep')
    for (const phaseHistory of ['Launch prep', { 0: 'Launch prep' }, {}, 1, null]) await expectDenied(leader(after({ phaseHistory })), `update: ${JSON.stringify(phaseHistory)}`)
  })

  test('a Raid Leader and a Member cannot start or reopen a phase', async () => {
    await stage('Launch prep')
    for (const who of ['raidLeader', 'member'] as const) await expectDenied(save(who, after({ currentPhase: 'Phase one', phaseHistory: ['Launch prep'] })), LABEL[who])
    assert.equal((await stored('settings/general'))?.phaseHistory, undefined)
  })
})
