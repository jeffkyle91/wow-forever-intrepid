// Loot priorities: the lootPriorities block of firestore.rules (validPriorityCreate, validPriorityEdit, validPriorityDelete).
//
// A priority is created, changed or deleted only together with its audit entry (type 'priority'), in the same batch, so a change to the
// council order can never go unlogged. The entry has to tell the truth (audit.test.ts and audit-details.test.ts cover the entry rules). On
// top of that this block checks what the entry cannot: the document's own fields and limits, the stamps the rules set (rev goes up by one,
// updatedBy and updatedAt), and the loot phase: a priority can be written only in the current phase or the next one, and never moved
// between phases. See docs/design/audit-first-loot.md.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteField, serverTimestamp, setDoc } from 'firebase/firestore'
import { LABEL, PLAYER_1, PLAYER_2, PLAYER_3, PRIORITY_ID, RAID_STAFF, UID, priorityDoc, without } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, setUpGuildEmulator, stored } from './support/harness.ts'
import { createPriority, deletePriority, editPriority, entryId, newPriorityDoc, type Staff } from './support/audit.ts'

setUpGuildEmulator()

/** Put the guild in phase `n`: n finished phases in its settings. */
const inPhase = (n: number) => asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { currentPhase: `Phase ${n}`, nextPhase: 'Next', phaseHistory: Array.from({ length: n }, (_, index) => `Earlier ${index}`) }))
/** Store a priority as an earlier version of the app left it, with the rules off. */
const store = (id: string, overrides: Record<string, unknown>) => asAdmin((db) => setDoc(guildDoc(db, `lootPriorities/${id}`), priorityDoc(overrides)))
const names = (count: number) => Array.from({ length: count }, (_, index) => `player-${index}`)

for (const who of RAID_STAFF as readonly Staff[]) {
  const make = (priority: Record<string, unknown> = {}, extra: Parameters<typeof createPriority>[2] = {}) => createPriority(dbFor(who), who, { fields: newPriorityDoc(priority), ...extra })

  describe(`a ${LABEL[who]} creates a priority`, () => {
    test('with its entry, a priority is stored with the stamps the rules set, and the entry says who made it', async () => {
      await expectAllowed(make())
      const saved = await stored('lootPriorities/priority-2')
      assert.equal(saved?.rev, 1)
      assert.equal(saved?.updatedBy, UID[who])
      assert.equal(saved?.phaseNo, 0)
      const logged = await stored(`auditLog/${entryId('priority', 'priority-2', 1)}`)
      assert.equal(logged?.by, UID[who])
      assert.equal(logged?.action, 'create')
      assert.equal(logged?.after?.item, 'Test Sword')
    })

    test('a priority from the drop lists, with its item, dungeon and creature, is accepted and logged', async () => {
      await expectAllowed(make({ itemId: 872, zoneId: 7, npcId: 4887 }))
      assert.deepEqual((await stored(`auditLog/${entryId('priority', 'priority-2', 1)}`))?.after?.itemId, 872)
    })

    test('a priority carried over from an earlier one, and an empty candidate list, are accepted', async () => {
      await expectAllowed(make({ carriedFrom: PRIORITY_ID, rankedPlayers: [] }))
    })

    test('the longest allowed values are accepted', async () => {
      await expectAllowed(make({ item: 'x'.repeat(120), encounter: 'x'.repeat(120), councilNote: 'x'.repeat(500), rankedPlayers: names(60), itemId: 100_000_000, zoneId: 100_000_000, npcId: 100_000_000, carriedFrom: 'x'.repeat(100) }))
    })

    test('a priority without its entry, or under another id, is refused', async () => {
      await expectDenied(make({}, { skipEntry: true }), 'no entry')
      await expectDenied(make({}, { entryKey: entryId('priority', 'someone-else', 1) }), 'an entry for another priority')
      await expectDenied(make({}, { audit: { action: 'edit' } }), 'an entry that says edit')
      await expectDenied(make({}, { audit: { after: { ...newPriorityDoc(), councilNote: 'a different note' } } }), 'an entry that lists another note')
    })

    for (const field of ['item', 'encounter', 'rankedPlayers', 'councilNote', 'phaseNo']) {
      test(`a priority with no ${field} is refused`, async () => {
        await expectDenied(createPriority(dbFor(who), who, { fields: without(newPriorityDoc(), field) }))
      })
    }
    for (const field of ['rev', 'updatedBy', 'updatedAt']) {
      test(`a priority with no ${field} is refused`, async () => {
        await expectDenied(make({}, { priority: { [field]: undefined } }))
      })
    }

    const bad: [string, Record<string, unknown>][] = [
      ['an unknown field', { extra: 'anything' }],
      ['a createdBy, which only awards have', { createdBy: UID[who] }],
      ['an empty item', { item: '' }],
      ['an item over 120 characters', { item: 'x'.repeat(121) }],
      ['an item that is not text', { item: 5 }],
      ['an encounter over 120 characters', { encounter: 'x'.repeat(121) }],
      ['an encounter that is not text', { encounter: ['Test Boss'] }],
      ['61 candidates', { rankedPlayers: names(61) }],
      ['candidates that are text, not a list', { rankedPlayers: 'player-1, player-2' }],
      ['a council note over 500 characters', { councilNote: 'x'.repeat(501) }],
      ['a council note that is not text', { councilNote: 5 }],
      ['an item id of 0', { itemId: 0 }],
      ['an item id of -1', { itemId: -1 }],
      ['an item id of 1.5', { itemId: 1.5 }],
      ['an item id that is text', { itemId: '872' }],
      ['an item id over 100 million', { itemId: 100_000_001 }],
      ['a dungeon id of 0', { zoneId: 0 }],
      ['a creature id that is text', { npcId: 'abc' }],
      ['a creature id of null', { npcId: null }],
      ['a carried-from id with a slash', { carriedFrom: 'a/b' }],
      ['a carried-from id that is empty', { carriedFrom: '' }],
      ['a carried-from id over 100 characters', { carriedFrom: 'x'.repeat(101) }],
      ['a carried-from id that is a number', { carriedFrom: 5 }],
    ]
    for (const [what, overrides] of bad) {
      test(`a priority with ${what} is refused`, async () => {
        await expectDenied(make(overrides))
      })
    }

    // The entry leaves the stamp fields out of what it lists, so the only thing that keeps another stamp-like field out of the document is the
    // key list in the rule itself.
    test('a priority with a stamp-like field it should not have is refused, even though the entry has nothing to say about it', async () => {
      await expectDenied(make({}, { priority: { createdBy: UID[who] } }), 'createdBy')
      await expectDenied(make({}, { priority: { createdAt: serverTimestamp() } }), 'createdAt')
    })

    const stamps: [string, Record<string, unknown>][] = [
      ['a revision other than 1', { rev: 2 }],
      ['a revision that is text', { rev: '1' }],
      ['a revision of 1.5', { rev: 1.5 }],
      ['someone else as the updater', { updatedBy: UID[who === 'guildLeader' ? 'raidLeader' : 'guildLeader'] }],
      ['an update time from the client', { updatedAt: new Date('2026-01-01T00:00:00Z') }],
      ['an update time that is text', { updatedAt: 'now' }],
    ]
    for (const [what, priority] of stamps) {
      test(`a priority with ${what} is refused`, async () => {
        await expectDenied(make({}, { priority }))
      })
    }
  })

  // The current phase is the number of finished phases in the settings (none stored means phase 0). A priority is filed under the current
  // phase, or the next one, which leaders prepare ahead of time.
  describe(`the loot phase of a priority a ${LABEL[who]} creates`, () => {
    test('the current phase and the next one are accepted, with no settings stored and with them', async () => {
      await expectAllowed(make({ phaseNo: 0 }, { id: 'p-a' }), 'phase 0 with no settings')
      await expectAllowed(make({ phaseNo: 1 }, { id: 'p-b' }), 'the next phase with no settings')
      await inPhase(2)
      await expectAllowed(make({ phaseNo: 2 }, { id: 'p-c' }), 'the current phase')
      await expectAllowed(make({ phaseNo: 3 }, { id: 'p-d' }), 'the next phase')
    })

    test('a finished phase, a phase two ahead, and numbers that are not phases are refused', async () => {
      await inPhase(2)
      for (const [index, phaseNo] of [0, 1, 4, 30, 31, -1, 2.5, '2', null].entries()) await expectDenied(make({ phaseNo }, { id: `p-bad-${index}` }), `phase ${JSON.stringify(phaseNo)} while the current phase is 2`)
    })
  })

  describe(`a ${LABEL[who]} changes a priority`, () => {
    const edit = (changes: Record<string, unknown>, extra: Parameters<typeof editPriority>[2] = {}) => editPriority(dbFor(who), who, { changes, ...extra })

    test('every editable field can be changed, with its entry, and the revision and stamps go up', async () => {
      await expectAllowed(edit({ item: 'Renamed Sword', encounter: 'Other Boss', rankedPlayers: [PLAYER_3, PLAYER_1], councilNote: 'New note', itemId: 872, zoneId: 7, npcId: 12 }))
      const saved = await stored(`lootPriorities/${PRIORITY_ID}`)
      assert.equal(saved?.rev, 1)
      assert.equal(saved?.updatedBy, UID[who])
      assert.deepEqual(saved?.rankedPlayers, [PLAYER_3, PLAYER_1])
      const logged = await stored(`auditLog/${entryId('priority', PRIORITY_ID, 1)}`)
      assert.deepEqual([...(logged?.changed as string[])].sort(), ['councilNote', 'encounter', 'item', 'itemId', 'npcId', 'rankedPlayers', 'zoneId'])
    })

    test('a reorder is accepted and logged as one', async () => {
      await expectAllowed(edit({ rankedPlayers: [PLAYER_3, PLAYER_2, PLAYER_1] }, { action: 'reorder' }))
      assert.equal((await stored(`auditLog/${entryId('priority', PRIORITY_ID, 1)}`))?.action, 'reorder')
    })

    test('the revision goes up by one each time and an entry is used once', async () => {
      await expectAllowed(edit({ councilNote: 'One' }))
      await expectDenied(edit({ councilNote: 'Two' }, { rev: 1 }), 'revision 1 again')
      await expectDenied(edit({ councilNote: 'Two' }, { rev: 3 }), 'jumping to revision 3')
      await expectAllowed(edit({ councilNote: 'Two' }, { rev: 2 }))
    })

    test('an optional field can be taken away, and the entry says so', async () => {
      await store(PRIORITY_ID, { phaseNo: 0, itemId: 872, zoneId: 7 })
      await expectAllowed(edit({ itemId: deleteField() }, { audit: { changed: ['itemId'], before: { itemId: 872 }, after: { itemId: null } } }))
      assert.equal((await stored(`lootPriorities/${PRIORITY_ID}`))?.itemId, undefined)
      assert.equal((await stored(`lootPriorities/${PRIORITY_ID}`))?.zoneId, 7)
    })

    test('an edit that adds a stamp-like field it should not have is refused, even though the entry has nothing to say about it', async () => {
      await expectDenied(edit({ councilNote: 'New note' }, { priority: { createdBy: UID[who] } }), 'createdBy')
      await expectDenied(edit({ councilNote: 'New note' }, { priority: { createdAt: serverTimestamp() } }), 'createdAt')
      await expectAllowed(edit({ councilNote: 'New note' }), 'the same edit without it')
    })

    test('a field the entry does not list is refused', async () => {
      await expectDenied(edit({ councilNote: 'New note', encounter: 'Other Boss' }, { audit: { changed: ['councilNote'], before: { councilNote: 'Test council note' }, after: { councilNote: 'New note' } } }))
    })

    const bad: [string, Record<string, unknown>][] = [
      ['an unknown field', { extra: 'anything' }],
      ['an empty item', { item: '' }],
      ['an item over 120 characters', { item: 'x'.repeat(121) }],
      ['an encounter over 120 characters', { encounter: 'x'.repeat(121) }],
      ['61 candidates', { rankedPlayers: names(61) }],
      ['candidates that are text', { rankedPlayers: 'player-1' }],
      ['a council note over 500 characters', { councilNote: 'x'.repeat(501) }],
      ['an item id of 0', { itemId: 0 }],
      ['an item id that is text', { itemId: '872' }],
      ['a creature id of 1.5', { npcId: 1.5 }],
      ['a dungeon id over 100 million', { zoneId: 100_000_001 }],
    ]
    for (const [what, changes] of bad) {
      test(`an edit that sets ${what} is refused`, async () => {
        await expectDenied(edit(changes))
      })
    }

    const stamps: [string, Record<string, unknown>][] = [
      ['no revision', { rev: undefined }],
      ['a revision that is text', { rev: '1' }],
      ['no updater', { updatedBy: undefined }],
      ['someone else as the updater', { updatedBy: UID[who === 'guildLeader' ? 'raidLeader' : 'guildLeader'] }],
      ['no update time', { updatedAt: undefined }],
      ['an update time from the client', { updatedAt: new Date('2026-01-01T00:00:00Z') }],
    ]
    for (const [what, priority] of stamps) {
      test(`an edit with ${what} is refused`, async () => {
        await expectDenied(edit({ councilNote: 'New note' }, { priority }))
      })
    }

    test('the phase of a priority, and the priority it was carried from, can never be changed', async () => {
      await inPhase(1)
      await store(PRIORITY_ID, { phaseNo: 1 })
      await expectDenied(edit({ phaseNo: 2 }), 'moved to the next phase')
      await expectDenied(edit({ phaseNo: 0 }), 'moved to a finished phase')
      await expectDenied(edit({ phaseNo: deleteField() }, { audit: { changed: ['phaseNo'], before: { phaseNo: 1 }, after: { phaseNo: null } } }), 'its phase taken away')
      await expectDenied(edit({ carriedFrom: 'other' }), 'a carried-from added')
      await store(PRIORITY_ID, { phaseNo: 1, carriedFrom: 'older' })
      await expectDenied(edit({ carriedFrom: 'other' }), 'a carried-from changed')
      await expectDenied(edit({ carriedFrom: deleteField() }, { audit: { changed: ['carriedFrom'], before: { carriedFrom: 'older' }, after: { carriedFrom: null } } }), 'a carried-from removed')
      await expectAllowed(edit({ councilNote: 'Still editable' }), 'an ordinary edit of the same priority')
    })

    test('a priority written before these limits can still be reordered, and a field that is not changed is not checked again', async () => {
      await store(PRIORITY_ID, { councilNote: 'x'.repeat(2000), encounter: 'z'.repeat(300) })
      await expectAllowed(edit({ rankedPlayers: [PLAYER_3, PLAYER_2, PLAYER_1] }, { action: 'reorder' }))
      await expectDenied(edit({ councilNote: 'z'.repeat(600) }, { rev: 2 }), 'a note that is changed has to be within the limit')
      await expectAllowed(edit({ councilNote: 'short now' }, { rev: 2 }), 'and may be shortened')
    })
  })

  // A finished phase is a record. The current phase and the next one can be written; a phase two ahead cannot exist.
  describe(`a ${LABEL[who]} and a priority of another phase`, () => {
    // The same priority twice (one to edit, one to delete), filed under `phaseNo` (none: no phase stored). Every call uses ids of its own,
    // because an entry id can be used only once.
    let calls = 0
    const attempt = async (phaseNo: number | undefined) => {
      const [edit, remove] = [`edit-${++calls}`, `remove-${calls}`]
      for (const id of [edit, remove]) await store(id, phaseNo === undefined ? {} : { phaseNo })
      const db = dbFor(who)
      return {
        edit: await editPriority(db, who, { id: edit, changes: { councilNote: 'New note' } }).then(() => 'allowed', () => 'denied'),
        remove: await deletePriority(db, who, { id: remove }).then(() => 'allowed', () => 'denied'),
      }
    }

    test('in the current phase a priority can be edited and deleted (a priority with no phase is in phase 0)', async () => {
      // No finished phase, so the current phase is 0.
      assert.deepEqual(await attempt(undefined), { edit: 'allowed', remove: 'allowed' })
      await asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { currentPhase: 'Phase 0', nextPhase: 'Next', phaseHistory: [] }))
      assert.deepEqual(await attempt(0), { edit: 'allowed', remove: 'allowed' })
    })

    test('in the next phase a priority can be edited and deleted', async () => {
      await inPhase(2)
      assert.deepEqual(await attempt(3), { edit: 'allowed', remove: 'allowed' })
    })

    test('in a finished phase a priority can be neither edited nor deleted', async () => {
      await inPhase(2)
      assert.deepEqual(await attempt(1), { edit: 'denied', remove: 'denied' })
      assert.deepEqual(await attempt(0), { edit: 'denied', remove: 'denied' })
      assert.deepEqual(await attempt(undefined), { edit: 'denied', remove: 'denied' }, 'a priority with no phase is in the first phase')
    })

    test('a priority two phases ahead, which no honest write can make, is not writable either', async () => {
      await inPhase(2)
      assert.deepEqual(await attempt(4), { edit: 'denied', remove: 'denied' })
    })

    test('starting a phase closes the priorities that were current', async () => {
      await store(PRIORITY_ID, { phaseNo: 0 })
      await expectAllowed(editPriority(dbFor(who), who, { changes: { councilNote: 'Before' } }))
      await inPhase(1)
      await expectDenied(editPriority(dbFor(who), who, { rev: 2, changes: { councilNote: 'After the phase closed' } }))
    })

    test('starting a phase opens the lists that were prepared for the next one', async () => {
      await store(PRIORITY_ID, { phaseNo: 1 })
      await expectAllowed(editPriority(dbFor(who), who, { changes: { councilNote: 'Prepared' } }))
      await inPhase(1)
      await expectAllowed(editPriority(dbFor(who), who, { rev: 2, changes: { councilNote: 'Now current' } }))
    })
  })

  describe(`a ${LABEL[who]} deletes a priority`, () => {
    test('with a delete entry for the next revision that lists every field it had', async () => {
      await store(PRIORITY_ID, { phaseNo: 0, itemId: 872, zoneId: 7, npcId: 4887, rev: 3 })
      await expectAllowed(deletePriority(dbFor(who), who, { rev: 4 }))
      assert.equal(await stored(`lootPriorities/${PRIORITY_ID}`), undefined)
      const logged = await stored(`auditLog/${entryId('priority', PRIORITY_ID, 4)}`)
      assert.equal(logged?.action, 'delete')
      assert.deepEqual([...(logged?.changed as string[])].sort(), ['councilNote', 'encounter', 'item', 'itemId', 'npcId', 'phaseNo', 'rankedPlayers', 'zoneId'])
      assert.equal(logged?.before?.itemId, 872)
    })

    test('without its entry, or with an entry for the wrong revision, it is refused', async () => {
      await store(PRIORITY_ID, { phaseNo: 0, rev: 3 })
      await expectDenied(deletePriority(dbFor(who), who, { rev: 4, skipEntry: true }), 'no entry')
      await expectDenied(deletePriority(dbFor(who), who, { rev: 3 }), 'the current revision')
      await expectDenied(deletePriority(dbFor(who), who, { rev: 5 }), 'a revision too high')
      assert.ok(await stored(`lootPriorities/${PRIORITY_ID}`))
    })

    test('an entry that leaves a field out is refused', async () => {
      await store(PRIORITY_ID, { phaseNo: 0, itemId: 872 })
      await expectDenied(deletePriority(dbFor(who), who, { audit: { changed: ['item', 'encounter', 'rankedPlayers', 'councilNote', 'phaseNo'], before: { item: 'Test Sword', encounter: 'Test Boss', rankedPlayers: [PLAYER_1, PLAYER_2, PLAYER_3], councilNote: 'Test council note', phaseNo: 0 } } }))
    })

    // The entry id is {type}_{id}_{revision} and an entry can never be written twice, so the id of a deleted priority cannot be created again at
    // revision 1. The app gives every new priority a fresh id.
    test('KNOWN GAP: the id of a deleted priority cannot be used again', async () => {
      await expectAllowed(createPriority(dbFor(who), who, { id: 'priority-2' }))
      await expectAllowed(deletePriority(dbFor(who), who, { id: 'priority-2', rev: 2 }))
      await expectDenied(createPriority(dbFor(who), who, { id: 'priority-2' }), 'the same id again')
      await expectAllowed(createPriority(dbFor(who), who, { id: 'priority-3' }), 'a fresh id')
    })
  })
}

describe('who may write a priority', () => {
  for (const who of ['member', 'stranger', 'otherGuildLeader', 'anonymous'] as const) {
    test(`a ${LABEL[who]} cannot create, edit or delete one, with every entry in place`, async () => {
      const db = dbFor(who)
      // The payload a Raid Leader would send, so that only the role can be what refuses it.
      await expectDenied(createPriority(db, 'raidLeader'), 'create')
      await expectDenied(editPriority(db, 'raidLeader'), 'edit')
      await expectDenied(deletePriority(db, 'raidLeader'), 'delete')
      assert.ok(await stored(`lootPriorities/${PRIORITY_ID}`))
      assert.equal(await stored('lootPriorities/priority-2'), undefined)
    })
  }

  test('the stamps are checked against the account that writes, so one leader cannot sign for another', async () => {
    await expectDenied(createPriority(dbFor('raidLeader'), 'guildLeader'), 'a Raid Leader signing as the Guild Leader')
    await expectDenied(editPriority(dbFor('guildLeader'), 'raidLeader'), 'a Guild Leader signing as the Raid Leader')
  })

  test('a plain write is refused even when it carries stamps and a phase', async () => {
    await expectDenied(setDoc(guildDoc(dbFor('raidLeader'), 'lootPriorities/priority-2'), { ...newPriorityDoc(), rev: 1, updatedBy: UID.raidLeader, updatedAt: serverTimestamp() }))
  })
})

// The entry lists the fields of the item (its id, dungeon and creature), the phase and the carried-from priority like any other field:
// what it says has to be what the document had and has, and it cannot leave one out.
describe('the entry of a priority is truthful about the item, the phase and where it came from', () => {
  const db = () => dbFor('raidLeader')
  for (const field of ['itemId', 'zoneId', 'npcId'] as const) {
    test(`an edit of ${field}: the entry cannot give another old or new value, or leave it out`, async () => {
      await store(PRIORITY_ID, { phaseNo: 0, [field]: 5 })
      await expectDenied(editPriority(db(), 'raidLeader', { changes: { [field]: 6 }, audit: { before: { [field]: 4 } } }), 'a wrong old value')
      await expectDenied(editPriority(db(), 'raidLeader', { changes: { [field]: 6 }, audit: { after: { [field]: 7 } } }), 'a wrong new value')
      await expectDenied(editPriority(db(), 'raidLeader', { changes: { [field]: 6 }, audit: { changed: [], before: {}, after: {} } }), 'the field left out')
      await expectAllowed(editPriority(db(), 'raidLeader', { changes: { [field]: 6 } }), 'the honest entry')
    })

    test(`a new priority with ${field}: the entry cannot give another value, or leave it out`, async () => {
      const fields = newPriorityDoc({ [field]: 5 })
      const honest = Object.keys(fields)
      await expectDenied(createPriority(db(), 'raidLeader', { fields, audit: { after: { ...fields, [field]: 6 } } }), 'a wrong value')
      await expectDenied(createPriority(db(), 'raidLeader', { fields, audit: { changed: honest.filter((key) => key !== field), after: Object.fromEntries(Object.entries(fields).filter(([key]) => key !== field)), before: {} } }), 'the field left out')
      await expectAllowed(createPriority(db(), 'raidLeader', { fields }), 'the honest entry')
    })

    test(`deleting a priority with ${field}: the entry has to show it`, async () => {
      await store(PRIORITY_ID, { phaseNo: 0, [field]: 5 })
      await expectDenied(deletePriority(db(), 'raidLeader', { audit: { before: { ...priorityDoc({ phaseNo: 0 }), [field]: 6 } } }), 'a wrong old value')
      await expectAllowed(deletePriority(db(), 'raidLeader'), 'the honest entry')
    })
  }

  for (const [field, value] of [['phaseNo', 1], ['carriedFrom', 'older-priority']] as const) {
    test(`a new priority with ${field}: the entry cannot give another value, or leave it out`, async () => {
      const fields = newPriorityDoc({ [field]: value })
      await expectDenied(createPriority(db(), 'raidLeader', { fields, audit: { after: { ...fields, [field]: field === 'phaseNo' ? 0 : 'another' } } }), 'a wrong value')
      await expectDenied(createPriority(db(), 'raidLeader', { fields, audit: { changed: Object.keys(fields).filter((key) => key !== field), before: {}, after: Object.fromEntries(Object.entries(fields).filter(([key]) => key !== field)) } }), 'the field left out')
      await expectAllowed(createPriority(db(), 'raidLeader', { fields }), 'the honest entry')
    })
  }
})
