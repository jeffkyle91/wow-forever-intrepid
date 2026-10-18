// The document of a loot phase (type 'phase' in the lootTables block of firestore.rules): which EARLIER phase this one follows.
//
// A phase that follows another has that phase's drop lists (zones, creatures, items) with its own documents on top; a phase with no `follows` starts from
// nothing. The number is always below the phase's own, so following never loops. The document is filed under p{phaseNo}, is written only with its audit
// entry (type 'table') in the same batch, only in the current phase or the next one, and is never deleted: taking the link away is an edit that removes
// `follows`. The zone, creature and presence documents are covered in loot-tables.test.ts.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, getDoc, serverTimestamp, setDoc, writeBatch, type DocumentData } from 'firebase/firestore'
import { LABEL, RAID_STAFF, UID } from './support/fixtures.ts'
import { dbFor, expectAllowed, expectDenied, guildDoc, outcomeOf, resetData, setUpGuildEmulator, stored } from './support/harness.ts'
import {
  GONE, ZONE_NO, clean, createTable, editTable, entry, entryId, inPhase, phaseTableDoc, phaseTableId, presenceTableDoc, sourceTableDoc, storeTable, zoneTableDoc, type CreateTableOptions,
  type EditTableOptions, type Staff,
} from './support/audit.ts'

setUpGuildEmulator()

for (const who of RAID_STAFF as readonly Staff[]) {
  const make = (fields: DocumentData, extra: Omit<CreateTableOptions, 'fields'> = {}) => createTable(dbFor(who), who, { fields, ...extra })
  const phase = (overrides: DocumentData = {}, extra: Omit<CreateTableOptions, 'fields'> = {}) => make(phaseTableDoc(overrides), extra)
  const editOf = (id: string, changes: DocumentData, extra: EditTableOptions = {}) => editTable(dbFor(who), who, { id, changes, ...extra })

  describe(`a ${LABEL[who]} creates the document of a phase`, () => {
    test('in the current phase, with its entry: the stamps are the rules\' own and the entry says what it follows', async () => {
      await inPhase(2)
      await expectAllowed(phase({ phaseNo: 2, follows: 1 }))
      const saved = await stored(`lootTables/${phaseTableId(2)}`)
      assert.equal(saved?.rev, 1)
      assert.equal(saved?.updatedBy, UID[who])
      assert.equal(saved?.follows, 1)
      const logged = await stored(`auditLog/${entryId('table', phaseTableId(2), 1)}`)
      assert.equal(logged?.action, 'create')
      assert.equal(logged?.by, UID[who])
      assert.equal(logged?.item, '', 'a phase document has no name, so its label is empty')
      assert.deepEqual([...((logged?.changed ?? []) as string[])].sort(), ['follows', 'phaseNo', 'type'])
      assert.equal(logged?.after?.follows, 1)
    })

    test('in the next phase (prepared ahead of time), and not in a finished phase or two ahead', async () => {
      await inPhase(2)
      await expectAllowed(phase({ phaseNo: 3, follows: 2 }), 'the next phase')
      await expectDenied(phase({ phaseNo: 1, follows: 0 }), 'a finished phase')
      await expectDenied(phase({ phaseNo: 4, follows: 3 }), 'two phases ahead')
      await expectDenied(phase({ phaseNo: 0, follows: undefined }), 'the first finished phase, with nothing to follow')
    })

    test('a phase that follows nothing is a document without `follows`', async () => {
      await inPhase(1)
      await expectAllowed(phase({ phaseNo: 1, follows: undefined }))
      assert.equal('follows' in ((await stored(`lootTables/${phaseTableId(1)}`)) ?? {}), false)
    })

    test('the first phase follows nothing, and any lower number is a phase another phase can follow', async () => {
      await expectAllowed(phase({ phaseNo: 0, follows: undefined }), 'phase 0 follows nothing')
      for (const follows of [0, 1, 2, 3, 4]) {
        await resetData()
        await inPhase(5)
        await expectAllowed(phase({ phaseNo: 5, follows }), `follows ${follows}`)
      }
    })

    test('it follows an earlier phase only: its own number, a later one, a negative one and anything that is not a whole number are refused', async () => {
      await inPhase(2)
      const bad: [string, unknown][] = [
        ['its own number', 2], ['the next phase', 3], ['a far later phase', 30], ['a negative number', -1], ['1.5', 1.5], ['1 as text', '1'], ['null', null],
        ['true', true], ['a list', [1]], ['a map', { a: 1 }], ['an empty string', ''], ['NaN', Number.NaN], ['infinity', Number.POSITIVE_INFINITY],
      ]
      for (const [label, follows] of bad) await expectDenied(phase({ phaseNo: 2, follows }), label)
      await expectAllowed(phase({ phaseNo: 2, follows: 0 }), 'the first phase')
    })

    test('a phase that is the next one cannot follow itself or a phase after it either', async () => {
      await inPhase(2)
      for (const follows of [3, 4]) await expectDenied(phase({ phaseNo: 3, follows }), `follows ${follows}`)
      await expectAllowed(phase({ phaseNo: 3, follows: 2 }), 'follows the current phase')
    })

    test('it says only type, phase and follows: any other field is refused', async () => {
      await inPhase(2)
      const extras: [string, DocumentData][] = [
        ['a zone number', { zoneId: 1581 }], ['a creature key', { key: 'c1' }], ['a name', { name: 'Phase 2' }], ['removed', { removed: true }], ['a kind', { kind: 'raid' }],
        ['items', { itemIds: [1] }], ['an unknown field', { extra: 1 }],
      ]
      for (const [label, extra] of extras) await expectDenied(phase({ phaseNo: 2, follows: 1, ...extra }), label)
      await expectDenied(phase({ phaseNo: 2, follows: 1 }, { table: { createdBy: UID[who] } }), 'createdBy, which only awards have')
      await expectDenied(phase({ phaseNo: 2, follows: 1 }, { table: { createdAt: serverTimestamp() } }), 'createdAt, which only awards have')
      await expectAllowed(phase({ phaseNo: 2, follows: 1 }), 'and without them')
    })

    for (const field of ['type', 'phaseNo']) {
      test(`with no ${field} it is refused`, async () => {
        await inPhase(2)
        await expectDenied(createTable(dbFor(who), who, { id: phaseTableId(2), fields: phaseTableDoc({ phaseNo: 2, [field]: undefined }) }))
      })
    }
    for (const field of ['rev', 'updatedBy', 'updatedAt']) {
      test(`with no ${field} it is refused`, async () => {
        await inPhase(2)
        await expectDenied(phase({ phaseNo: 2 }, { table: { [field]: undefined } }))
      })
    }

    test('the stamps are checked: revision 1, the leader as updater, the server time', async () => {
      await inPhase(2)
      const stamps: [string, DocumentData][] = [
        ['a revision other than 1', { rev: 2 }], ['a revision that is text', { rev: '1' }], ['a revision of 1.5', { rev: 1.5 }],
        ['someone else as the updater', { updatedBy: UID[who === 'guildLeader' ? 'raidLeader' : 'guildLeader'] }],
        ['an update time from the client', { updatedAt: new Date('2026-01-01T00:00:00Z') }],
      ]
      for (const [label, table] of stamps) await expectDenied(phase({ phaseNo: 2 }, { table }), label)
      await expectAllowed(phase({ phaseNo: 2 }), 'the honest write')
    })

    test('it is filed under p and its phase number, and nothing else', async () => {
      await inPhase(2)
      for (const id of ['p1', 'p3', 'p02', 'P2', 'p2_0', 'p', 'z2_2', 'phase2', `z${ZONE_NO}_2`, 's1_c1_2', '2']) await expectDenied(createTable(dbFor(who), who, { id, fields: phaseTableDoc({ phaseNo: 2 }) }), id)
      await expectDenied(createTable(dbFor(who), who, { id: phaseTableId(2), fields: zoneTableDoc({ phaseNo: 2 }) }), 'a zone under the id of a phase')
      await expectDenied(createTable(dbFor(who), who, { id: phaseTableId(2), fields: sourceTableDoc({ phaseNo: 2 }) }), 'a creature under the id of a phase')
      await expectDenied(createTable(dbFor(who), who, { id: phaseTableId(2), fields: presenceTableDoc({ phaseNo: 2 }) }), 'a presence document under the id of a phase')
      await expectAllowed(phase({ phaseNo: 2 }), 'the id its fields make')
    })

    test('without its entry, or with an entry that does not tell the truth, it is refused', async () => {
      await inPhase(2)
      await expectDenied(phase({ phaseNo: 2 }, { skipEntry: true }), 'no entry')
      await expectDenied(phase({ phaseNo: 2 }, { entryKey: entryId('table', phaseTableId(3), 1) }), 'an entry for another phase')
      await expectDenied(phase({ phaseNo: 2 }, { audit: { action: 'edit' } }), 'an entry that says edit')
      await expectDenied(phase({ phaseNo: 2 }, { audit: { action: 'delete' } }), 'an entry that says delete')
      await expectDenied(phase({ phaseNo: 2 }, { audit: { item: 'Phase 2' } }), 'an entry with a label')
      await expectDenied(phase({ phaseNo: 2 }, { audit: { after: { type: 'phase', phaseNo: 2, follows: 1 } } }), 'an entry that says it follows another phase')
      await expectDenied(phase({ phaseNo: 2 }, { audit: { changed: ['type', 'phaseNo'], before: { type: null, phaseNo: null }, after: { type: 'phase', phaseNo: 2 } } }), 'an entry that leaves out follows')
      await expectDenied(phase({ phaseNo: 2 }, { audit: { changed: ['type', 'phaseNo', 'follows', 'name'], before: { type: null, phaseNo: null, follows: null, name: null }, after: { type: 'phase', phaseNo: 2, follows: 1, name: 'x' } } }), 'an entry that lists a field the document does not have')
      await expectAllowed(phase({ phaseNo: 2 }), 'the honest entry')
    })

    test('a second create of the same phase is refused (the document is there; it is edited)', async () => {
      await inPhase(2)
      await expectAllowed(phase({ phaseNo: 2, follows: 1 }))
      await expectDenied(phase({ phaseNo: 2, follows: 0 }), 'created again')
    })
  })

  describe(`a ${LABEL[who]} changes the document of a phase`, () => {
    test('what it follows: another earlier phase, then nothing, then a phase again; each edit is one revision and its entry shows the old and the new value', async () => {
      await inPhase(3)
      await storeTable(phaseTableId(3), phaseTableDoc({ phaseNo: 3, follows: 2 }))
      await expectAllowed(editOf(phaseTableId(3), { follows: 1 }), 'another phase')
      const first = await stored(`auditLog/${entryId('table', phaseTableId(3), 2)}`)
      assert.deepEqual(first?.changed, ['follows'])
      assert.equal(first?.before?.follows, 2)
      assert.equal(first?.after?.follows, 1)
      await expectAllowed(editOf(phaseTableId(3), { follows: GONE }), 'nothing')
      assert.equal('follows' in ((await stored(`lootTables/${phaseTableId(3)}`)) ?? {}), false)
      const second = await stored(`auditLog/${entryId('table', phaseTableId(3), 3)}`)
      assert.equal(second?.before?.follows, 1)
      assert.equal(second?.after?.follows, null)
      await expectAllowed(editOf(phaseTableId(3), { follows: 0 }), 'a phase again')
      assert.equal((await stored(`lootTables/${phaseTableId(3)}`))?.rev, 4)
    })

    test('the next phase can be edited too, and a finished phase cannot', async () => {
      await inPhase(2)
      await storeTable(phaseTableId(3), phaseTableDoc({ phaseNo: 3, follows: 2 }))
      await storeTable(phaseTableId(1), phaseTableDoc({ phaseNo: 1, follows: 0 }))
      await storeTable(phaseTableId(2), phaseTableDoc({ phaseNo: 2, follows: 1 }))
      await expectAllowed(editOf(phaseTableId(3), { follows: 1 }), 'the next phase')
      await expectAllowed(editOf(phaseTableId(2), { follows: 0 }), 'the current phase')
      await expectDenied(editOf(phaseTableId(1), { follows: GONE }), 'a finished phase')
    })

    test('a phase two ahead that was stored (a phase was reopened) cannot be edited until it is the next one', async () => {
      await inPhase(2)
      await storeTable(phaseTableId(4), phaseTableDoc({ phaseNo: 4, follows: 3 }))
      await expectDenied(editOf(phaseTableId(4), { follows: 2 }))
    })

    test('it still has to follow an earlier phase: its own number, a later one and anything that is not a whole number are refused', async () => {
      await inPhase(3)
      await storeTable(phaseTableId(3), phaseTableDoc({ phaseNo: 3, follows: 2 }))
      for (const follows of [3, 4, 31, -1, 1.5, '1', null, true, [1], { a: 1 }]) await expectDenied(editOf(phaseTableId(3), { follows }), JSON.stringify(follows))
      await expectAllowed(editOf(phaseTableId(3), { follows: 0 }), 'an earlier phase')
    })

    test('what it is cannot change: its phase and its kind of document, and nothing else can be added', async () => {
      await inPhase(3)
      await storeTable(phaseTableId(3), phaseTableDoc({ phaseNo: 3, follows: 2 }))
      await expectDenied(editOf(phaseTableId(3), { phaseNo: 2 }), 'phase')
      await expectDenied(editOf(phaseTableId(3), { phaseNo: 4 }), 'the next phase\'s number')
      await expectDenied(editOf(phaseTableId(3), { phaseNo: GONE }), 'phase taken away')
      await expectDenied(editOf(phaseTableId(3), { type: 'zone' }), 'type')
      await expectDenied(editOf(phaseTableId(3), { type: GONE }), 'type taken away')
      for (const [field, value] of Object.entries({ zoneId: 1581, key: 'c1', name: 'Phase 3', kind: 'raid', removed: true, itemIds: [1], extra: 'x' })) await expectDenied(editOf(phaseTableId(3), { [field]: value }), field)
      await expectAllowed(editOf(phaseTableId(3), { follows: 1 }), 'an ordinary edit of the same document')
    })

    test('the revision goes up by one and the stamps are checked', async () => {
      await inPhase(3)
      await storeTable(phaseTableId(3), phaseTableDoc({ phaseNo: 3, follows: 2 }))
      const stamps: [string, DocumentData][] = [
        ['no revision', { rev: undefined }], ['a revision that is text', { rev: '2' }], ['a revision of 2.5', { rev: 2.5 }], ['no updater', { updatedBy: undefined }],
        ['someone else as the updater', { updatedBy: UID[who === 'guildLeader' ? 'raidLeader' : 'guildLeader'] }], ['no update time', { updatedAt: undefined }],
        ['an update time from the client', { updatedAt: new Date('2026-01-01T00:00:00Z') }],
      ]
      for (const [label, table] of stamps) await expectDenied(editOf(phaseTableId(3), { follows: 1 }, { table }), label)
      await expectDenied(editOf(phaseTableId(3), { follows: 1 }, { rev: 3 }), 'two steps')
      await expectDenied(editOf(phaseTableId(3), { follows: 1 }, { rev: 1 }), 'no step')
      await expectAllowed(editOf(phaseTableId(3), { follows: 1 }), 'the honest edit')
    })

    test('without its entry, or with an entry that lies about the change, it is refused', async () => {
      await inPhase(3)
      await storeTable(phaseTableId(3), phaseTableDoc({ phaseNo: 3, follows: 2 }))
      await expectDenied(editOf(phaseTableId(3), { follows: 1 }, { skipEntry: true }), 'no entry')
      await expectDenied(editOf(phaseTableId(3), { follows: 1 }, { entryKey: entryId('table', phaseTableId(3), 5) }), 'an entry with the wrong revision')
      await expectDenied(editOf(phaseTableId(3), { follows: 1 }, { audit: { action: 'create' } }), 'an entry that says create')
      await expectDenied(editOf(phaseTableId(3), { follows: 1 }, { audit: { after: { follows: 0 } } }), 'an entry with another new value')
      await expectDenied(editOf(phaseTableId(3), { follows: 1 }, { audit: { before: { follows: 1 } } }), 'an entry with another old value')
      await expectDenied(editOf(phaseTableId(3), { follows: 1 }, { audit: { changed: [], before: {}, after: {} } }), 'an entry that says nothing changed')
      await expectDenied(editOf(phaseTableId(3), { follows: GONE }, { audit: { after: { follows: 2 } } }), 'an entry that says it still follows')
      await expectDenied(editOf(phaseTableId(3), { follows: GONE }, { audit: { after: {} , changed: [], before: {} } }), 'an entry that leaves out the removal')
      assert.equal((await stored(`lootTables/${phaseTableId(3)}`))?.follows, 2, 'nothing was written')
    })
  })

  describe(`a ${LABEL[who]} and the documents of a phase beside its zones and creatures`, () => {
    test('one batch can create the phase document and a zone presence for it, each with its entry', async () => {
      await inPhase(1)
      const batch = writeBatch(dbFor(who))
      createTable(dbFor(who), who, { into: batch, fields: phaseTableDoc({ phaseNo: 2, follows: 1 }) })
      createTable(dbFor(who), who, { into: batch, fields: presenceTableDoc({ phaseNo: 2, removed: false }) })
      createTable(dbFor(who), who, { into: batch, fields: zoneTableDoc({ phaseNo: 2 }) })
      await expectAllowed(batch.commit())
    })

    test('a phase document does not stand in for a zone or creature document: an edit that turns one into the other is refused', async () => {
      await inPhase(1)
      await storeTable(phaseTableId(1), phaseTableDoc({ phaseNo: 1, follows: 0 }))
      await expectDenied(editOf(phaseTableId(1), { type: 'zone', zoneId: 1581, follows: GONE, removed: true }))
      await expectDenied(editOf(phaseTableId(1), { type: 'source', zoneId: 1581, key: 'npc1', itemIds: [], hiddenItemIds: [], follows: GONE }))
    })

    test('a document of another kind cannot gain follows', async () => {
      await inPhase(1)
      await storeTable('z1581_1', presenceTableDoc({ phaseNo: 1 }))
      await storeTable(`z${ZONE_NO}_1`, zoneTableDoc({ phaseNo: 1 }))
      await storeTable(`s${ZONE_NO}_c1_1`, sourceTableDoc({ phaseNo: 1 }))
      await expectDenied(editOf('z1581_1', { follows: 0 }), 'a presence document')
      await expectDenied(editOf(`z${ZONE_NO}_1`, { follows: 0 }), 'a zone of the guild\'s own')
      await expectDenied(editOf(`s${ZONE_NO}_c1_1`, { follows: 0 }), 'a creature')
    })
  })
}

describe('who may write the document of a phase', () => {
  for (const who of ['member', 'stranger', 'otherGuildLeader', 'anonymous'] as const) {
    test(`a ${LABEL[who]} cannot create or edit one, with the entry in place`, async () => {
      await inPhase(1)
      await storeTable(phaseTableId(2), phaseTableDoc({ phaseNo: 2, follows: 0 }))
      await expectDenied(createTable(dbFor(who), 'raidLeader', { fields: phaseTableDoc({ phaseNo: 1, follows: 0 }) }), 'create')
      await expectDenied(editTable(dbFor(who), 'raidLeader', { id: phaseTableId(2), changes: { follows: 1 } }), 'edit')
      assert.equal((await stored(`lootTables/${phaseTableId(2)}`))?.follows, 0)
    })
  }

  test('a plain write is refused even when it carries stamps', async () => {
    await inPhase(1)
    await expectDenied(setDoc(guildDoc(dbFor('raidLeader'), `lootTables/${phaseTableId(1)}`), clean({ ...phaseTableDoc(), rev: 1, updatedBy: UID.raidLeader, updatedAt: serverTimestamp() })))
  })

  test('every guild role can read it, and nobody else', async () => {
    await storeTable(phaseTableId(1), phaseTableDoc())
    for (const who of ['member', 'raidLeader', 'guildLeader'] as const) assert.equal(await outcomeOf(getDoc(guildDoc(dbFor(who), `lootTables/${phaseTableId(1)}`))), 'allowed', who)
    for (const who of ['stranger', 'otherGuildLeader', 'anonymous'] as const) assert.equal(await outcomeOf(getDoc(guildDoc(dbFor(who), `lootTables/${phaseTableId(1)}`))), 'denied', who)
  })
})

describe('the document of a phase is never deleted', () => {
  for (const who of ['member', 'raidLeader', 'guildLeader', 'stranger', 'anonymous'] as const) {
    test(`not by a ${LABEL[who]}, with an entry for the delete or without one`, async () => {
      await inPhase(1)
      await storeTable(phaseTableId(1), phaseTableDoc())
      await expectDenied(deleteDoc(guildDoc(dbFor(who), `lootTables/${phaseTableId(1)}`)), 'a plain delete')
      const batch = writeBatch(dbFor(who))
      batch.delete(guildDoc(dbFor(who), `lootTables/${phaseTableId(1)}`))
      batch.set(guildDoc(dbFor(who), `auditLog/${entryId('table', phaseTableId(1), 2)}`), entry(who === 'raidLeader' || who === 'guildLeader' ? who : 'raidLeader', 'table', phaseTableId(1), 2, { action: 'delete', item: '', changed: [] }))
      await expectDenied(batch.commit(), 'a delete with a delete entry')
      assert.ok(await stored(`lootTables/${phaseTableId(1)}`), 'it is still there')
    })
  }
})
