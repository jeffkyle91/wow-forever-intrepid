import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { awardCreateFields, describeCreate, describeDelete, describeEdit, legacyAwardEntry, priorityAuditFields, readAuditEntry, sameValue } from '../../src/shared/game/lootAudit.ts'

// Invented names.
const priority = { item: 'Test Sword', encounter: 'Test Hall \u00b7 Warden', rankedPlayers: ['Aria', 'Brock'], councilNote: '', phaseNo: 0, itemId: 101 }

describe('sameValue', () => {
  it('compares lists by their contents and order', () => {
    assert.ok(sameValue(['a', 'b'], ['a', 'b']))
    assert.equal(sameValue(['a', 'b'], ['b', 'a']), false)
    assert.equal(sameValue(['a'], ['a', 'a']), false)
    assert.equal(sameValue([], undefined), false)
  })
  it('compares everything else strictly', () => {
    assert.ok(sameValue('x', 'x') && sameValue(3, 3) && sameValue(undefined, undefined))
    assert.equal(sameValue(1, '1'), false)
    assert.equal(sameValue(null, undefined), false)
  })
})

describe('describeCreate', () => {
  it('lists every field the new document has, with its value', () => {
    const { changed, after } = describeCreate(priority, priorityAuditFields)
    assert.deepEqual(changed, ['item', 'encounter', 'rankedPlayers', 'councilNote', 'itemId', 'phaseNo'])
    assert.deepEqual(after, priority)
  })
  it('leaves out a field that is undefined, and a field that is not listed', () => {
    const { changed, after } = describeCreate({ ...priority, npcId: undefined, rev: 1, updatedBy: 'someone' }, priorityAuditFields)
    assert.equal(changed.includes('npcId'), false)
    assert.equal('npcId' in after, false)
    assert.equal(changed.includes('rev'), false)
  })
  it('lists the fields of a new award', () => {
    const award = { priorityId: 'p1', item: 'Test Sword', encounter: 'x', recipient: 'Aria', recipientId: 'player-1', awardedAt: '2026-12-09', prioritySnapshot: ['Aria'], prioritySnapshotIds: ['player-1'], councilNoteSnapshot: '', awardNote: '', phaseNo: 0 }
    assert.deepEqual(describeCreate(award, awardCreateFields).changed, [...awardCreateFields])
  })
})

describe('describeEdit', () => {
  it('lists only the fields that differ, with the old and new value', () => {
    const edit = describeEdit(priority, { item: 'Test Sword', councilNote: 'Healer first', rankedPlayers: ['Brock', 'Aria'] }, priorityAuditFields)
    assert.deepEqual(edit, {
      changed: ['rankedPlayers', 'councilNote'],
      before: { rankedPlayers: ['Aria', 'Brock'], councilNote: '' },
      after: { rankedPlayers: ['Brock', 'Aria'], councilNote: 'Healer first' },
    })
  })
  it('gives nothing when nothing differs', () => {
    assert.equal(describeEdit(priority, { item: 'Test Sword', rankedPlayers: ['Aria', 'Brock'] }, priorityAuditFields), null)
    assert.equal(describeEdit(priority, {}, priorityAuditFields), null)
  })
  it('says a field that is added had nothing before (null)', () => {
    assert.deepEqual(describeEdit(priority, { zoneId: 7 }, priorityAuditFields), { changed: ['zoneId'], before: { zoneId: null }, after: { zoneId: 7 } })
  })
  it('says a field that is taken away is null after (an undefined new value removes it)', () => {
    assert.deepEqual(describeEdit(priority, { itemId: undefined }, priorityAuditFields), { changed: ['itemId'], before: { itemId: 101 }, after: { itemId: null } })
  })
  it('does not list a field the entry may not (a stamp, an unknown field)', () => {
    assert.equal(describeEdit(priority, { rev: 4, surprise: 'x' }, priorityAuditFields), null)
  })
})

describe('describeDelete', () => {
  it('lists every listed field the document had, and nothing else', () => {
    const { changed, before } = describeDelete({ ...priority, rev: 3, updatedBy: 'someone', updatedAt: 'x' }, priorityAuditFields)
    assert.deepEqual(changed, ['item', 'encounter', 'rankedPlayers', 'councilNote', 'itemId', 'phaseNo'])
    assert.deepEqual(before, priority)
  })
})

describe('readAuditEntry', () => {
  const stored = { at: { toDate: () => new Date('2026-12-09T20:00:00Z') }, by: 'uid-1', byName: 'A Leader', targetType: 'priority', targetId: 'p1', rev: 2, action: 'edit', item: 'Test Sword', changed: ['councilNote'], before: { councilNote: '' }, after: { councilNote: 'New' }, reason: 'Fixing a typo' }
  it('reads a whole entry', () => {
    const entry = readAuditEntry('priority_p1_2', stored)!
    assert.equal(entry.at?.toISOString(), '2026-12-09T20:00:00.000Z')
    assert.deepEqual([entry.byName, entry.targetType, entry.rev, entry.action, entry.item, entry.changed, entry.reason], ['A Leader', 'priority', 2, 'edit', 'Test Sword', ['councilNote'], 'Fixing a typo'])
    assert.deepEqual(entry.after, { councilNote: 'New' })
  })
  it('keeps an entry whose time is not there yet (a write still on its way) and makes odd fields empty', () => {
    const entry = readAuditEntry('award_a1_1', { targetType: 'award', targetId: 'a1', at: null, changed: ['x', 5], before: 'old', rev: 'two' })!
    assert.equal(entry.at, null)
    assert.deepEqual([entry.changed, entry.before, entry.rev, entry.byName], [['x'], {}, 0, ''])
  })
  it('drops an entry with no target, and never throws', () => {
    assert.equal(readAuditEntry('x', {}), null)
    assert.equal(readAuditEntry('', stored), null)
    assert.equal(readAuditEntry('x', { targetType: 'award', targetId: 'a', at: { toDate: () => new Date(NaN) } })!.at, null)
  })
})

describe('legacyAwardEntry', () => {
  const award = { id: 'a1', priorityId: 'p1', item: 'Test Sword', encounter: 'Test Hall', recipient: 'Aria', awardedAt: '2026-11-05', prioritySnapshot: ['Aria', 'Brock'], councilNoteSnapshot: 'Note', awardNote: '' }
  it('is an entry of revision 0 for the award, dated the raid night, with the fields the award has', () => {
    const entry = legacyAwardEntry(award)
    assert.deepEqual([entry.targetType, entry.targetId, entry.rev, entry.action, entry.item, entry.byName], ['award', 'a1', 0, 'create', 'Test Sword', ''])
    assert.equal(entry.at?.getFullYear(), 2026)
    assert.equal(entry.at?.getMonth(), 10)
    assert.equal(entry.at?.getDate(), 5)
    assert.deepEqual(entry.changed, ['priorityId', 'item', 'encounter', 'recipient', 'awardedAt', 'prioritySnapshot', 'councilNoteSnapshot', 'awardNote'])
    assert.equal(entry.after.recipient, 'Aria')
  })
  it('has no date when the award has none that reads, and leaves out fields the award lacks', () => {
    const entry = legacyAwardEntry({ id: 'a2', item: 'X', encounter: '', recipient: 'Aria', awardedAt: 'last Tuesday' })
    assert.equal(entry.at, null)
    assert.equal(entry.changed.includes('prioritySnapshot'), false)
  })
})
