// The guild settings document, guilds/<guildId>/settings/general: every guild member may read it, only a
// Guild Leader may write it, and the write must have exactly the expected fields.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, getDoc, setDoc, writeBatch } from 'firebase/firestore'
import { ANY_ROLE, LABEL, LEADER_ONLY, SIGNED_IN, without, type Persona } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, setUpGuildEmulator, stored } from './support/harness.ts'
import { changePhase, clean, entry, entryId } from './support/audit.ts'

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

// The loot phases: `phaseHistory` lists the finished phases, oldest first, and its length is the current phase's number. It can change in only
// two ways (a phase is started or the last one reopened), each way has to keep the names truthful, and each one is a step of `phaseRev` with its
// own change log entry (phase_settings_{n}) in the same batch. The entry rules are in phase-audit.test.ts.
describe('the loot phase history', () => {
  const leader = (data: Record<string, unknown>) => save('guildLeader', data)
  const names = (count: number) => Array.from({ length: count }, (_, index) => `Phase ${index + 1}`)
  // The stored settings, as an earlier save left them (`rev` is how many times a phase has been started or reopened).
  const stage = (current: string, history?: string[], next = 'Phase one', rev?: number) =>
    asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { ...validSettings(), currentPhase: current, nextPhase: next, ...(history ? { phaseHistory: history } : {}), ...(rev ? { phaseRev: rev } : {}) }))
  const after = (change: Record<string, unknown>) => ({ ...validSettings(), ...change })
  // A phase change with its entry, by a Guild Leader unless told otherwise.
  const go = (settings: Record<string, unknown>, options: Omit<Parameters<typeof changePhase>[2], 'settings'> = {}) => changePhase(dbFor('guildLeader'), 'guildLeader', { settings, ...options })

  test('settings without a history, and with an empty one, are accepted', async () => {
    await expectAllowed(leader(validSettings()), 'none')
    await expectAllowed(leader(after({ phaseHistory: [] })), 'an empty list')
  })

  test('a guild that never closed a phase can start one: the old current name goes on the end of the list', async () => {
    await stage('Launch prep')
    await expectAllowed(go(after({ currentPhase: 'Phase one', nextPhase: 'To be announced', phaseHistory: ['Launch prep'] })))
    const saved = await stored('settings/general')
    assert.deepEqual(saved?.phaseHistory, ['Launch prep'])
    assert.equal(saved?.phaseRev, 1)
  })

  test('a second phase can be started the same way, one step further on', async () => {
    await stage('Phase one', ['Launch prep'], 'Phase one', 1)
    await expectAllowed(go(after({ currentPhase: 'Phase two', phaseHistory: ['Launch prep', 'Phase one'] }), { rev: 2 }))
  })

  test('the list can grow to 30 names, and no further', async () => {
    await stage('Phase 30', names(29), 'Phase one', 29)
    await expectAllowed(go(after({ currentPhase: 'Phase 31', phaseHistory: [...names(29), 'Phase 30'] }), { rev: 30 }), 'the 30th name')
    await stage('Phase 31', names(30), 'Phase one', 30)
    await expectDenied(go(after({ currentPhase: 'Phase 32', phaseHistory: [...names(30), 'Phase 31'] }), { rev: 31 }), 'the 31st name')
  })

  test('starting a phase has to name the phase that was current', async () => {
    await stage('Launch prep')
    await expectDenied(go(after({ currentPhase: 'Phase one', phaseHistory: ['Something else'] })), 'another name')
    await expectDenied(go(after({ currentPhase: 'Phase one', phaseHistory: ['Phase one'] })), 'the new name')
  })

  test('starting two phases in one save is refused', async () => {
    await stage('Launch prep')
    await expectDenied(go(after({ currentPhase: 'Phase two', phaseHistory: ['Launch prep', 'Phase one'] })))
  })

  test('starting a phase cannot change a name already in the list', async () => {
    await stage('Phase two', ['Launch prep', 'Phase one'], 'Phase one', 2)
    await expectDenied(go(after({ currentPhase: 'Phase three', phaseHistory: ['Renamed', 'Phase one', 'Phase two'] }), { rev: 3 }), 'an earlier name')
    await expectDenied(go(after({ currentPhase: 'Phase three', phaseHistory: ['Phase one', 'Launch prep', 'Phase two'] }), { rev: 3 }), 'a different order')
  })

  test('the first save of the settings can start a phase, closing the default current phase', async () => {
    await expectAllowed(go(after({ currentPhase: 'Phase one', nextPhase: 'To be announced', phaseHistory: ['Launch prep'] })))
    assert.deepEqual((await stored('settings/general'))?.phaseHistory, ['Launch prep'])
    assert.deepEqual((await stored(`auditLog/${entryId('phase', 'settings', 1)}`))?.before, { currentPhase: null, nextPhase: null, phaseHistory: null })
  })

  test('the first save cannot close any other name, close more than one phase, or reopen one', async () => {
    await expectDenied(go(after({ currentPhase: 'Phase one', phaseHistory: ['Something else'] })), 'another name')
    await expectDenied(go(after({ currentPhase: 'Phase two', phaseHistory: ['Launch prep', 'Phase one'] })), 'two phases')
    await expectDenied(leader(after({ phaseHistory: 'Launch prep' })), 'text')
  })

  test('the last phase can be reopened: its name becomes current again and the name being left becomes the next phase', async () => {
    await stage('Phase one', ['Launch prep'], 'To be announced', 1)
    await expectAllowed(go(after({ currentPhase: 'Launch prep', nextPhase: 'Phase one' }), { rev: 2, action: 'reopen' }), 'without the field')
    const saved = await stored('settings/general')
    assert.equal(saved?.currentPhase, 'Launch prep')
    assert.equal(saved?.phaseRev, 2)
    await stage('Phase two', ['Launch prep', 'Phase one'], 'To be announced', 2)
    await expectAllowed(go(after({ currentPhase: 'Phase one', nextPhase: 'Phase two', phaseHistory: ['Launch prep'] }), { rev: 3, action: 'reopen' }), 'one name left')
  })

  test('reopening has to bring back the name that was last in the list, and name the phase being left as next', async () => {
    await stage('Phase two', ['Launch prep', 'Phase one'], 'Phase one', 2)
    await expectDenied(go(after({ currentPhase: 'Launch prep', nextPhase: 'Phase two', phaseHistory: ['Launch prep'] }), { rev: 3, action: 'reopen' }), 'the wrong phase brought back')
    await expectDenied(go(after({ currentPhase: 'Phase one', nextPhase: 'Something else', phaseHistory: ['Launch prep'] }), { rev: 3, action: 'reopen' }), 'the wrong next phase')
  })

  test('reopening two phases in one save is refused', async () => {
    await stage('Phase two', ['Launch prep', 'Phase one'], 'Phase one', 2)
    await expectDenied(go(after({ currentPhase: 'Launch prep', nextPhase: 'Phase two' }), { rev: 3, action: 'reopen' }))
  })

  test('reopening cannot change a name that stays in the list', async () => {
    await stage('Phase three', ['Launch prep', 'Phase one', 'Phase two'], 'Phase one', 3)
    const reopen = (phaseHistory: string[]) => go(after({ currentPhase: 'Phase two', nextPhase: 'Phase three', phaseHistory }), { rev: 4, action: 'reopen' })
    await expectDenied(reopen(['Hacked', 'Phase one']), 'a changed earlier name')
    await expectDenied(reopen(['Phase one', 'Launch prep']), 'a reordered list')
    await expectAllowed(reopen(['Launch prep', 'Phase one']), 'the honest reopening')
  })

  // These go through go(), with the next revision, an honest entry and a `reopen` action (so the entry does not say "start"), so that what refuses
  // them is the rule on how the history may change and not the revision or the entry.
  test('the list cannot be replaced or reordered', async () => {
    await stage('Phase two', ['Launch prep', 'Phase one'], 'Phase one', 2)
    const rewrite = (phaseHistory: string[]) => go(after({ currentPhase: 'Phase two', phaseHistory }), { rev: 3, action: 'reopen' })
    await expectDenied(rewrite(['Phase one', 'Launch prep']), 'reordered')
    await expectDenied(rewrite(['Other', 'Names']), 'other names')
    await expectDenied(rewrite(['Launch prep', 'Rewritten']), 'the last name rewritten')
    await expectDenied(rewrite([]), 'emptied')
  })

  test('the list cannot be added to without starting a phase', async () => {
    await stage('Launch prep')
    await expectDenied(leader(after({ phaseHistory: ['Earlier phase'] })), 'with the current name unchanged')
  })

  test('saving the other settings leaves the list and the revision as they are, and the current phase can be renamed without an entry', async () => {
    await stage('Phase one', ['Launch prep'], 'Phase one', 1)
    await expectAllowed(leader(after({ currentPhase: 'Phase 1 (renamed)', councilStatus: 'live', phaseHistory: ['Launch prep'], phaseRev: 1 })))
    const saved = await stored('settings/general')
    assert.deepEqual(saved?.phaseHistory, ['Launch prep'])
    assert.equal(saved?.phaseRev, 1)
  })

  test('a history that is not a list is refused', async () => {
    for (const phaseHistory of ['Launch prep', { 0: 'Launch prep' }, {}, 1, null]) await expectDenied(leader(after({ phaseHistory })), `first save: ${JSON.stringify(phaseHistory)}`)
    await stage('Launch prep')
    for (const phaseHistory of ['Launch prep', { 0: 'Launch prep' }, {}, 1, null]) await expectDenied(leader(after({ phaseHistory })), `update: ${JSON.stringify(phaseHistory)}`)
  })

  // The same with a revision and an entry, so that nothing but the shape of the list can be what refuses it.
  test('a history that is not a list is refused even with the next revision and its entry', async () => {
    // A `reopen` entry, so that an empty map (which has no names, like an empty list) is not refused by the entry for not being a start.
    const odd = (phaseHistory: unknown) => go(after({ currentPhase: 'Phase one', phaseHistory }), { action: 'reopen' })
    for (const phaseHistory of ['Launch prep', { 0: 'Launch prep' }, {}, 1]) await expectDenied(odd(phaseHistory), `first save: ${JSON.stringify(phaseHistory)}`)
    await stage('Launch prep')
    for (const phaseHistory of ['Launch prep', { 0: 'Launch prep' }, {}, 1]) await expectDenied(odd(phaseHistory), `update: ${JSON.stringify(phaseHistory)}`)
  })

  test('a Raid Leader and a Member cannot start or reopen a phase', async () => {
    await stage('Launch prep')
    for (const who of ['raidLeader', 'member'] as const) await expectDenied(changePhase(dbFor(who), 'raidLeader', { settings: after({ currentPhase: 'Phase one', phaseHistory: ['Launch prep'] }) }), LABEL[who])
    assert.equal((await stored('settings/general'))?.phaseHistory, undefined)
  })

  test('start, reopen and start again each take the next revision and leave their own entry', async () => {
    await stage('Launch prep')
    await expectAllowed(go(after({ currentPhase: 'Phase one', phaseHistory: ['Launch prep'] })), 'start')
    await expectAllowed(go(after({ currentPhase: 'Launch prep', nextPhase: 'Phase one' }), { rev: 2, action: 'reopen' }), 'reopen')
    await expectAllowed(go(after({ currentPhase: 'Phase one', nextPhase: 'To be announced', phaseHistory: ['Launch prep'] }), { rev: 3 }), 'start again')
    for (const rev of [1, 2, 3]) assert.ok(await stored(`auditLog/${entryId('phase', 'settings', rev)}`), `entry ${rev}`)
    assert.equal((await stored('settings/general'))?.phaseRev, 3)
  })
})

// A change of the phase history is one step of `phaseRev` and has its entry, which has to say truthfully what changed.
describe('the change log entry of a phase', () => {
  const stage = () => asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { ...validSettings(), currentPhase: 'Phase one', nextPhase: 'Phase two', phaseHistory: ['Launch prep'], phaseRev: 1 }))
  const next = () => ({ ...validSettings(), currentPhase: 'Phase two', nextPhase: 'To be announced', phaseHistory: ['Launch prep', 'Phase one'] })
  const go = (options: Omit<Parameters<typeof changePhase>[2], 'settings'> = {}) => changePhase(dbFor('guildLeader'), 'guildLeader', { settings: next(), rev: 2, ...options })

  test('the honest entry is accepted, and says who, what the phase fields were and what they are now', async () => {
    await stage()
    await expectAllowed(go())
    const logged = await stored(`auditLog/${entryId('phase', 'settings', 2)}`)
    assert.equal(logged?.action, 'start')
    assert.equal(logged?.item, 'Phase two')
    assert.deepEqual([...(logged?.changed as string[])].sort(), ['currentPhase', 'nextPhase', 'phaseHistory'])
    assert.deepEqual(logged?.before, { currentPhase: 'Phase one', nextPhase: 'Phase two', phaseHistory: ['Launch prep'] })
    assert.deepEqual(logged?.after, { currentPhase: 'Phase two', nextPhase: 'To be announced', phaseHistory: ['Launch prep', 'Phase one'] })
  })

  test('a change of the history without its entry is refused', async () => {
    await stage()
    await expectDenied(go({ skipEntry: true }))
  })

  test('the settings and the entry have to carry the next revision, and nothing else', async () => {
    await stage()
    await expectDenied(go({ rev: 1 }), 'the revision that already exists')
    await expectDenied(go({ rev: 3 }), 'a revision too far ahead')
    await expectDenied(go({ doc: { phaseRev: 3 } }), 'settings further ahead than the entry')
    await expectDenied(go({ doc: { phaseRev: 1 } }), 'settings that stay at the old revision')
    await expectDenied(go({ doc: { phaseRev: 2.5 }, audit: { rev: 2.5 }, entryKey: 'phase_settings_2.5' }), 'a revision that is not a whole number')
    await expectDenied(go({ entryKey: entryId('phase', 'settings', 3) }), 'an entry filed under another revision')
  })

  test('the revision cannot change when the history does not', async () => {
    await stage()
    const plain = (phaseRev: unknown) => save('guildLeader', { ...validSettings(), currentPhase: 'Phase one', nextPhase: 'Phase two', phaseHistory: ['Launch prep'], ...(phaseRev === undefined ? {} : { phaseRev }) })
    await expectDenied(plain(2), 'one step up with no change of the history')
    await expectDenied(plain(0), 'back to 0')
    await expectDenied(plain(undefined), 'dropped')
    await expectAllowed(plain(1), 'left as it is')
  })

  test('an entry that lies, or leaves something out, is refused', async () => {
    await stage()
    const honest = { currentPhase: { before: 'Phase one', after: 'Phase two' }, nextPhase: { before: 'Phase two', after: 'To be announced' }, phaseHistory: { before: ['Launch prep'], after: ['Launch prep', 'Phase one'] } }
    const lie = (field: keyof typeof honest, side: 'before' | 'after', value: unknown) => ({ [side]: Object.fromEntries(Object.entries(honest).map(([key, pair]) => [key, key === field ? value : pair[side]])) })
    for (const field of Object.keys(honest) as (keyof typeof honest)[]) {
      await expectDenied(go({ audit: lie(field, 'before', 'something else') }), `a wrong old ${field}`)
      await expectDenied(go({ audit: lie(field, 'after', 'something else') }), `a wrong new ${field}`)
      await expectDenied(go({ audit: { changed: ['currentPhase', 'nextPhase', 'phaseHistory'].filter((key) => key !== field) } }), `${field} left out of the list`)
    }
    await expectDenied(go({ audit: { changed: ['currentPhase', 'nextPhase', 'phaseHistory', 'councilStatus'] } }), 'a field that did not change')
    await expectDenied(go({ audit: { item: 'Another phase' } }), 'the wrong phase name')
    await expectDenied(go({ action: 'reopen' }), 'a reopen entry for a start')
    await expectDenied(go({ action: 'edit' }), 'an action that is not a phase action')
    await expectAllowed(go(), 'the honest entry')
  })

  test('an entry that swaps in a field that did not change for one that did, or carries other keys, is refused', async () => {
    // The next phase stays "To be announced", so only the current phase and the history change.
    await asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { ...validSettings(), currentPhase: 'Phase one', nextPhase: 'To be announced', phaseHistory: ['Launch prep'], phaseRev: 1 }))
    const honestBefore = { currentPhase: 'Phase one', phaseHistory: ['Launch prep'] }
    const honestAfter = { currentPhase: 'Phase two', phaseHistory: ['Launch prep', 'Phase one'] }
    await expectDenied(go({ audit: { changed: ['currentPhase', 'nextPhase'], before: { currentPhase: 'Phase one', nextPhase: 'To be announced' }, after: { currentPhase: 'Phase two', nextPhase: 'To be announced' } } }), 'the next phase listed instead of the history')
    await expectDenied(go({ audit: { before: { ...honestBefore, councilStatus: 'deliberating' } } }), 'an extra key in before')
    await expectDenied(go({ audit: { after: { ...honestAfter, councilStatus: 'live' } } }), 'an extra key in after')
    await expectDenied(go({ audit: { changed: ['currentPhase', 'phaseHistory', 'nextPhase'] } }), 'a field that did not change listed as well')
    await expectDenied(go({ audit: { changed: ['currentPhase', 'currentPhase', 'phaseHistory'] } }), 'a field listed twice')
    await expectAllowed(go(), 'the honest entry, which lists only the two that changed')
    assert.deepEqual([...((await stored(`auditLog/${entryId('phase', 'settings', 2)}`))?.changed as string[])].sort(), ['currentPhase', 'phaseHistory'])
  })

  test('an entry for a phase has to be a start or a reopen, whatever else the history does', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { ...validSettings(), currentPhase: 'Phase two', nextPhase: 'To be announced', phaseHistory: ['Launch prep', 'Phase one'], phaseRev: 2 }))
    const reopen = { ...validSettings(), currentPhase: 'Phase one', nextPhase: 'Phase two', phaseHistory: ['Launch prep'] }
    for (const action of ['edit', 'create', 'remove', 'delete', 'reorder', 'cancel', 'Reopen', '']) await expectDenied(changePhase(dbFor('guildLeader'), 'guildLeader', { settings: reopen, rev: 3, action }), `the action "${action}"`)
    await expectAllowed(changePhase(dbFor('guildLeader'), 'guildLeader', { settings: reopen, rev: 3, action: 'reopen' }), 'a reopen')
  })

  test('the revision has an upper limit', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { ...validSettings(), currentPhase: 'Phase one', nextPhase: 'Phase two', phaseHistory: ['Launch prep'], phaseRev: 1_000_000 }))
    await expectDenied(go({ rev: 1_000_001 }))
  })

  test('an entry for a start has to be a start, and one for a reopen a reopen', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { ...validSettings(), currentPhase: 'Phase two', nextPhase: 'To be announced', phaseHistory: ['Launch prep', 'Phase one'], phaseRev: 2 }))
    const reopen = { ...validSettings(), currentPhase: 'Phase one', nextPhase: 'Phase two', phaseHistory: ['Launch prep'] }
    await expectDenied(changePhase(dbFor('guildLeader'), 'guildLeader', { settings: reopen, rev: 3, action: 'start' }), 'a start entry for a reopen')
    await expectAllowed(changePhase(dbFor('guildLeader'), 'guildLeader', { settings: reopen, rev: 3, action: 'reopen' }), 'a reopen entry')
  })

  // Everything about the entry is right (the next revision, the current phase's name as its item, an action, nothing listed as changed) except that
  // the settings do not move with it. Only the rule that ties the entry to the settings' own revision refuses it, and it matters: a stray entry would
  // use up the revision the next honest start needs, for ever, because an entry can never be rewritten.
  test('an entry cannot be written alone, by a Guild Leader or a Raid Leader', async () => {
    await stage()
    for (const who of ['guildLeader', 'raidLeader'] as const) {
      const db = dbFor(who)
      for (const action of ['reopen', 'start']) {
        const batch = writeBatch(db)
        batch.set(guildDoc(db, `auditLog/${entryId('phase', 'settings', 2)}`), clean(entry(who, 'phase', 'settings', 2, { action, item: 'Phase one', changed: [], before: {}, after: {} })))
        await expectDenied(batch.commit(), `${who}, ${action}`)
      }
    }
    assert.equal(await stored(`auditLog/${entryId('phase', 'settings', 2)}`), undefined)
    await expectAllowed(go(), 'and the honest start is still possible afterwards')
  })

  test('a Guild Leader cannot add another entry to the batch that starts a phase', async () => {
    await stage()
    // A copy of the honest entry, so that nothing about it lies: only that it is an extra entry, for another target or another revision.
    const stray = (id: string, targetId: string, rev = 2) => [id, entry('guildLeader', 'phase', targetId, rev, {
      action: 'start', item: 'Phase two', changed: ['currentPhase', 'nextPhase', 'phaseHistory'],
      before: { currentPhase: 'Phase one', nextPhase: 'Phase two', phaseHistory: ['Launch prep'] },
      after: { currentPhase: 'Phase two', nextPhase: 'To be announced', phaseHistory: ['Launch prep', 'Phase one'] },
    })] as [string, Record<string, unknown>]
    await expectDenied(go({ extraEntries: [stray('phase_extra_2', 'extra')] }), 'an entry for another target')
    await expectDenied(go({ extraEntries: [stray(entryId('phase', 'settings', 3), 'settings', 3)] }), 'an entry for a later revision')
    await expectAllowed(go(), 'the honest batch')
  })

  test('an entry that exists cannot be changed or deleted, even by the Guild Leader who wrote it', async () => {
    await stage()
    await expectAllowed(go())
    const path = `auditLog/${entryId('phase', 'settings', 2)}`
    const before = await stored(path)
    await expectDenied(setDoc(guildDoc(dbFor('guildLeader'), path), { ...before, item: 'Rewritten' }), 'rewriting it')
    await expectDenied(deleteDoc(guildDoc(dbFor('guildLeader'), path)), 'deleting it')
    assert.deepEqual(await stored(path), before)
  })
})
