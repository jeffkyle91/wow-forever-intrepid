// Roster ids on loot priorities and awards (LOOT-003): the `rankedIds` field of a priority and the `recipientId` and `prioritySnapshotIds` fields
// of an award made from a priority. See docs/design/audit-first-loot.md.
//
// A priority's candidates stay names (the snapshot of what each line said) and gain a parallel list of ids: a roster character's id, '' for an
// open note (an idea such as "any warlock who didn't get X", not a person) or '!' for a finished note. The rules check the shape of that list
// (as long as the names), not its elements and not that every id is on the roster. An award is checked against the roster: its recipientId must be a
// character that has the recipient's name, and it must be on a character line of the priority, or the priority must have an open note.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteField, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { LABEL, PLAYER_1, PLAYER_2, PLAYER_3, RAID_STAFF, UID, priorityDoc, rosterDoc } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, setUpGuildEmulator, stored } from './support/harness.ts'
import { clean, createAward, createManualAward, createPriority, deletePriority, describeChange, editAward, editPriority, entry, entryId, newAwardDoc, newPriorityDoc, stamp, stampedAward, type Staff } from './support/audit.ts'

setUpGuildEmulator()

const NOTE = "Any warlock who didn't get the Test Staff last phase"
const name = (n: number) => rosterDoc(n).name // the seeded roster characters player-1 .. player-3
const IDS = 'priority-ids' // a stored priority that has candidates by id and an open note at the end
const LINES = [name(1), name(2), NOTE]
const LINE_IDS = [PLAYER_1, PLAYER_2, '']

/** Store a priority as the app writes it after this change (or without ids, as before), with the rules off. */
const store = (id: string, overrides: Record<string, unknown> = {}) => asAdmin((db) => setDoc(guildDoc(db, `lootPriorities/${id}`), priorityDoc({ phaseNo: 0, ...overrides })))
const storeIds = (overrides: Record<string, unknown> = {}) => store(IDS, { rankedPlayers: LINES, rankedIds: LINE_IDS, ...overrides })

const names60 = () => Array.from({ length: 60 }, (_, index) => `player-${index}`)
const stored1Of = () => ({ rankedPlayers: LINES, rankedIds: LINE_IDS })

/** An award made from the priority IDS to the roster character `n`, as the app writes it. Honest unless overridden. */
const awardFrom = (priority: Record<string, unknown>, n: number, overrides: Record<string, unknown> = {}) =>
  clean(newAwardDoc({
    priorityId: IDS, recipient: name(n), recipientId: `player-${n}`,
    prioritySnapshot: priority.rankedPlayers, prioritySnapshotIds: priority.rankedIds, ...overrides,
  }))

describe('a priority with ids', () => {
  for (const who of RAID_STAFF as readonly Staff[]) {
    const make = (fields: Record<string, unknown>, extra: Parameters<typeof createPriority>[2] = {}) => createPriority(dbFor(who), who, { fields: newPriorityDoc(fields), ...extra })

    test(`a ${LABEL[who]} creates one with a character, an open note and a finished note, and the entry lists the ids`, async () => {
      await expectAllowed(make({ rankedPlayers: [...LINES, 'Done idea'], rankedIds: [...LINE_IDS, '!'] }))
      const logged = await stored(`auditLog/${entryId('priority', 'priority-2', 1)}`)
      assert.ok(((logged?.changed ?? []) as string[]).includes('rankedIds'))
      assert.deepEqual(logged?.after?.rankedIds, [PLAYER_1, PLAYER_2, '', '!'])
    })

    test(`a ${LABEL[who]} can still create one without ids, and one with no candidates at all`, async () => {
      await expectAllowed(make({}))
      await expectAllowed(make({ rankedPlayers: [], rankedIds: [] }, { id: 'priority-3' }))
    })

    test('the longest list, sixty lines of the longest ids, is accepted', async () => {
      await expectAllowed(make({ rankedPlayers: names60(), rankedIds: Array.from({ length: 60 }, () => 'x'.repeat(100)) }))
    })

    const bad: [string, unknown][] = [
      ['one id too few', [PLAYER_1, PLAYER_2]],
      ['one id too many', [PLAYER_1, PLAYER_2, '', PLAYER_3]],
      ['not a list', 'player-1,player-2,'],
      ['a map', { 0: PLAYER_1, 1: PLAYER_2, 2: '' }],
    ]
    for (const [label, rankedIds] of bad) {
      test(`${label} is refused`, async () => {
        await expectDenied(make({ rankedPlayers: LINES, rankedIds }))
      })
    }

    test('sixty-one ids, and ids on sixty-one names, are refused', async () => {
      await expectDenied(make({ rankedPlayers: names60(), rankedIds: Array.from({ length: 61 }, () => 'x') }))
      await expectDenied(make({ rankedPlayers: [...names60(), 'one more'], rankedIds: Array.from({ length: 61 }, () => 'x') }))
    })

    test('ids cannot be added to a priority that already has more than sixty names (the cap holds when only the ids change)', async () => {
      await store('legacy-61', { rankedPlayers: Array.from({ length: 61 }, (_, index) => `n${index}`) })
      await expectDenied(editPriority(dbFor(who), who, { id: 'legacy-61', changes: { rankedIds: Array.from({ length: 61 }, (_, index) => `id${index}`) } }))
    })

    test('an entry that leaves the ids out, or says other ids, is refused', async () => {
      const fields = newPriorityDoc({ rankedPlayers: LINES, rankedIds: LINE_IDS })
      await expectDenied(createPriority(dbFor(who), who, { fields, audit: { changed: Object.keys(fields).filter((key) => key !== 'rankedIds'), after: clean({ ...fields, rankedIds: undefined }) } }), 'an entry without the ids')
      await expectDenied(createPriority(dbFor(who), who, { fields, audit: { after: { ...fields, rankedIds: [PLAYER_2, PLAYER_1, ''] } } }), 'an entry with other ids')
    })

    test(`a ${LABEL[who]} reorders the lines, and the entry says both lists changed`, async () => {
      await storeIds()
      await expectAllowed(editPriority(dbFor(who), who, { id: IDS, action: 'reorder', changes: { rankedPlayers: [name(2), name(1), NOTE], rankedIds: [PLAYER_2, PLAYER_1, ''] } }))
      const logged = await stored(`auditLog/${entryId('priority', IDS, 1)}`)
      assert.equal(logged?.action, 'reorder')
      assert.deepEqual(((logged?.changed ?? []) as string[]).slice().sort(), ['rankedIds', 'rankedPlayers'])
    })

    test('a reorder entry that lists anything besides the two lists, or leaves the ids out of what changed, is refused', async () => {
      await storeIds()
      const changes = { rankedPlayers: [name(2), name(1), NOTE], rankedIds: [PLAYER_2, PLAYER_1, ''] }
      await expectDenied(editPriority(dbFor(who), who, { id: IDS, action: 'reorder', changes: { ...changes, councilNote: 'Also this' } }), 'a reorder that changes the note too')
      await expectDenied(editPriority(dbFor(who), who, { id: IDS, action: 'reorder', changes, audit: { changed: ['rankedPlayers'], before: { rankedPlayers: LINES }, after: { rankedPlayers: changes.rankedPlayers } } }), 'an entry that hides the ids')
    })

    test('an old priority gets its ids when a leader edits it, and the ids can be taken away again', async () => {
      await store('legacy-1', { rankedPlayers: [name(1), name(2)] })
      await expectAllowed(editPriority(dbFor(who), who, { id: 'legacy-1', changes: { rankedIds: [PLAYER_1, PLAYER_2] } }))
      await expectAllowed(editPriority(dbFor(who), who, { id: 'legacy-1', rev: 2, changes: { rankedIds: deleteField() }, audit: { changed: ['rankedIds'], before: { rankedIds: [PLAYER_1, PLAYER_2] }, after: {} } }))
      assert.equal((await stored('lootPriorities/legacy-1'))?.rankedIds, undefined)
    })

    test('a note can be finished: its marker changes from an empty string to "!"', async () => {
      await storeIds()
      await expectAllowed(editPriority(dbFor(who), who, { id: IDS, changes: { rankedIds: [PLAYER_1, PLAYER_2, '!'] } }))
    })

    test('a new line can be put in the middle, with both lists longer by one', async () => {
      await storeIds()
      await expectAllowed(editPriority(dbFor(who), who, { id: IDS, changes: { rankedPlayers: [name(1), name(3), name(2), NOTE], rankedIds: [PLAYER_1, PLAYER_3, PLAYER_2, ''] } }))
    })

    test('names changed to a different length while the ids stay are refused', async () => {
      await storeIds()
      await expectDenied(editPriority(dbFor(who), who, { id: IDS, changes: { rankedPlayers: [name(1), name(2)] } }))
      await expectDenied(editPriority(dbFor(who), who, { id: IDS, changes: { rankedIds: [PLAYER_1] } }))
    })

    // KNOWN GAP, pinned on purpose: the rules cannot tell a reorder from a text change of a note, so an edit that moves names and leaves the ids as
    // they were is accepted when the lengths agree. Only an app that was open before this change does that, and it reloads on the next release.
    test('KNOWN GAP: names reordered with the ids left alone are accepted (the lists can fall out of line)', async () => {
      await storeIds()
      await expectAllowed(editPriority(dbFor(who), who, { id: IDS, action: 'reorder', changes: { rankedPlayers: [name(2), name(1), NOTE] } }))
    })

    test('the text of a note can be changed while the ids stay', async () => {
      await storeIds()
      await expectAllowed(editPriority(dbFor(who), who, { id: IDS, changes: { rankedPlayers: [name(1), name(2), 'Any mage who did not get it'] } }))
    })

    test('a priority stored with ids that do not line up with its names can still have its note edited, but touching the lists checks them', async () => {
      await storeIds({ rankedIds: [PLAYER_1, PLAYER_2] })
      await expectAllowed(editPriority(dbFor(who), who, { id: IDS, changes: { councilNote: 'Only the note' } }))
      await expectDenied(editPriority(dbFor(who), who, { id: IDS, rev: 2, changes: { rankedPlayers: [name(2), name(1), NOTE] } }), 'the names reordered, ids still two')
      await expectAllowed(editPriority(dbFor(who), who, { id: IDS, rev: 2, changes: { rankedIds: [PLAYER_2, PLAYER_1, ''], rankedPlayers: [name(2), name(1), NOTE] } }), 'both lists written together')
    })

    test('a priority with ids can be deleted, and the entry lists the ids', async () => {
      await storeIds()
      await expectAllowed(deletePriority(dbFor(who), who, { id: IDS }))
      assert.deepEqual((await stored(`auditLog/${entryId('priority', IDS, 1)}`))?.before?.rankedIds, LINE_IDS)
    })
  }

  test('a Member cannot write ids', async () => {
    await expectDenied(createPriority(dbFor('member'), 'raidLeader', { fields: newPriorityDoc({ rankedPlayers: LINES, rankedIds: LINE_IDS }) }))
  })
})

describe('an award made from a priority, with ids', () => {
  for (const who of RAID_STAFF as readonly Staff[]) {
    const award = (priority: Record<string, unknown>, n: number, overrides: Record<string, unknown> = {}, extra: Parameters<typeof createAward>[2] = {}) =>
      createAward(dbFor(who), who, { fields: awardFrom(priority, n, overrides), ...extra })
    const stored1 = stored1Of()

    test(`a ${LABEL[who]} awards to a character on the list, by id, and the entry lists the id and the snapshot ids`, async () => {
      await storeIds()
      await expectAllowed(award(stored1, 1))
      const saved = await stored('awards/award-new')
      assert.equal(saved?.recipientId, PLAYER_1)
      assert.deepEqual(saved?.prioritySnapshotIds, LINE_IDS)
      const logged = await stored(`auditLog/${entryId('award', 'award-new', 1)}`)
      assert.ok(((logged?.changed ?? []) as string[]).includes('recipientId'))
      assert.ok(((logged?.changed ?? []) as string[]).includes('prioritySnapshotIds'))
    })

    test('the snapshot ids have to be the priority\'s ids as they stand: missing, reordered or invented ones are refused', async () => {
      await storeIds()
      await expectDenied(award(stored1, 1, { prioritySnapshotIds: undefined }), 'no snapshot ids')
      await expectDenied(award(stored1, 1, { prioritySnapshotIds: [PLAYER_2, PLAYER_1, ''] }), 'reordered')
      await expectDenied(award(stored1, 1, { prioritySnapshotIds: [PLAYER_1, PLAYER_2, '!'] }), 'a note marker changed')
      await expectDenied(award(stored1, 1, { prioritySnapshotIds: [] }), 'empty')
    })

    test('an award from an old priority without ids needs no snapshot ids, and invented ones are refused', async () => {
      await store(IDS, { rankedPlayers: [name(1), name(2)] })
      const legacy = { rankedPlayers: [name(1), name(2)] }
      await expectAllowed(award(legacy, 1, { prioritySnapshotIds: undefined }))
      await expectDenied(award(legacy, 1, { prioritySnapshotIds: [PLAYER_1, PLAYER_2] }, { id: 'award-two' }), 'ids the priority does not have')
    })

    test('an award that names no id still works for an old priority listed by name (an app from before this change)', async () => {
      await store(IDS, { rankedPlayers: [name(1), name(2)] })
      await expectAllowed(award({ rankedPlayers: [name(1), name(2)] }, 2, { recipientId: undefined, prioritySnapshotIds: undefined }))
    })

    test('the recipient id has to be a roster character with that name', async () => {
      await storeIds()
      await expectDenied(award(stored1, 1, { recipientId: PLAYER_2 }), 'the id of another character')
      await expectDenied(award(stored1, 1, { recipientId: 'player-99' }), 'an id that is not on the roster')
      await expectDenied(award(stored1, 1, { recipientId: 'player 1' }), 'an id with a space')
      await expectDenied(award(stored1, 1, { recipientId: 5 }), 'a number')
      await expectDenied(award(stored1, 1, { recipientId: '' }), 'an empty id')
    })

    test('a roster character that is not on the list can receive it when the priority has an open note, and only then', async () => {
      await storeIds()
      await expectAllowed(award(stored1, 3), 'through the open note')
      await expectDenied(award(stored1, 3, { recipientId: undefined }, { id: 'award-two' }), 'by name only, the name is not on the list')
    })

    test('no open note means no way in for someone who is not on the list: no note, a finished note, or a note line with an id', async () => {
      await storeIds({ rankedPlayers: [name(1), name(2)], rankedIds: [PLAYER_1, PLAYER_2] })
      await expectDenied(award({ rankedPlayers: [name(1), name(2)], rankedIds: [PLAYER_1, PLAYER_2] }, 3), 'a list of characters only')
      await storeIds({ rankedIds: [PLAYER_1, PLAYER_2, '!'] })
      await expectDenied(award({ rankedPlayers: LINES, rankedIds: [PLAYER_1, PLAYER_2, '!'] }, 3, {}, { id: 'award-two' }), 'a finished note')
    })

    test('an award to a character on a character line still works when the priority also has an open note', async () => {
      await storeIds()
      await expectAllowed(award(stored1, 2))
    })

    test('the snapshot names have to be the priority\'s names as they stand, with or without ids', async () => {
      await storeIds()
      await expectDenied(award(stored1, 1, { prioritySnapshot: [name(2), name(1), NOTE] }))
    })

    test('a character renamed since the priority was written still receives it by id, under the name the roster has now (a list with no open note)', async () => {
      const plain = { rankedPlayers: [name(1), name(2)], rankedIds: [PLAYER_1, PLAYER_2] }
      await storeIds(plain)
      await asAdmin((db) => setDoc(guildDoc(db, `roster/${PLAYER_1}`), rosterDoc(1, { name: 'Renamed One' })))
      await expectAllowed(award(plain, 1, { recipient: 'Renamed One' }), 'the new name, the same id')
      await expectDenied(award(plain, 1, { recipient: name(1) }, { id: 'award-two' }), 'the old name no longer matches the roster')
      await expectDenied(award(plain, 1, { recipient: 'Renamed One', recipientId: PLAYER_3 }, { id: 'award-three' }), 'a name the roster does not give that id')
    })

    test('a recipient id of a shape the app never makes is refused even when such a roster document exists', async () => {
      await storeIds()
      await asAdmin((db) => setDoc(guildDoc(db, 'roster/guest.1'), rosterDoc(9, { name: 'Guest Nine' })))
      await expectDenied(award(stored1, 9, { recipient: 'Guest Nine', recipientId: 'guest.1' }))
    })

    test('an entry that lies about the snapshot ids, or about the recipient id, is refused', async () => {
      await storeIds()
      const fields = awardFrom(stored1, 1)
      await expectDenied(award(stored1, 1, {}, { audit: { after: { ...fields, prioritySnapshotIds: [PLAYER_2, PLAYER_1, ''] } } }), 'other snapshot ids in the entry')
      await expectDenied(award(stored1, 1, {}, { id: 'award-two', audit: { after: { ...fields, recipientId: PLAYER_2 } } }), 'another recipient id in the entry')
    })
  }

  test('a Member cannot record an award with ids', async () => {
    await storeIds()
    await expectDenied(createAward(dbFor('member'), 'raidLeader', { fields: awardFrom(stored1Of(), 1) }))
  })

  test('a manual award does not take snapshot ids, and still works as before', async () => {
    await expectAllowed(createManualAward(dbFor('guildLeader'), 'guildLeader', {}))
    await expectDenied(createManualAward(dbFor('guildLeader'), 'guildLeader', { id: 'manual-2', fields: { item: 'Test Sword', encounter: 'Test Boss', recipient: name(2), recipientId: PLAYER_2, awardedAt: '2026-12-09', awardNote: '', decision: 'roll', phaseNo: 0, prioritySnapshotIds: [] } }))
  })
})

describe('an award can be corrected, but its snapshot ids are fixed', () => {
  test('the snapshot ids cannot be edited, and the recipient id can be corrected with a reason in the log', async () => {
    await storeIds()
    await expectAllowed(createAward(dbFor('guildLeader'), 'guildLeader', { fields: awardFrom(stored1Of(), 1) }))
    const current = await stored('awards/award-new')
    const edit = (rev: number, changes: Record<string, unknown>) => {
      const batch = writeBatch(dbFor('guildLeader'))
      batch.update(guildDoc(dbFor('guildLeader'), 'awards/award-new'), clean({ ...changes, ...stamp('guildLeader', rev) }))
      batch.set(guildDoc(dbFor('guildLeader'), `auditLog/${entryId('award', 'award-new', rev)}`), clean(entry('guildLeader', 'award', 'award-new', rev, { item: current?.item, ...describeChange(current, changes) })))
      return batch.commit()
    }
    await expectDenied(edit(2, { prioritySnapshotIds: [PLAYER_2, PLAYER_1, ''] }), 'a changed snapshot')
    await expectAllowed(edit(2, { recipient: name(2), recipientId: PLAYER_2 }), 'the recipient corrected')
  })
})

describe('a receipt through an open note: the award and the line that takes its place, in one batch', () => {
  /** What the app writes: the award to `n` (a snapshot of the list as it stood), the priority with `n` as a new character line above the note,
   *  and an entry for each. */
  async function receive(who: Staff, n: number, { snapshot = stored1Of(), insert = true, priorityEntry = true, awardEntry = true }: { snapshot?: { rankedPlayers: unknown; rankedIds: unknown }; insert?: boolean; priorityEntry?: boolean; awardEntry?: boolean } = {}) {
    const db = dbFor(who)
    const current = await stored(`lootPriorities/${IDS}`)
    const fields = awardFrom(snapshot, n)
    const changes = { rankedPlayers: [name(1), name(2), name(n), NOTE], rankedIds: [PLAYER_1, PLAYER_2, `player-${n}`, ''] }
    const batch = writeBatch(db)
    batch.set(guildDoc(db, 'awards/award-note'), clean({ ...fields, rev: 1, createdBy: UID[who], createdAt: serverTimestamp() }))
    if (awardEntry) batch.set(guildDoc(db, `auditLog/${entryId('award', 'award-note', 1)}`), clean(entry(who, 'award', 'award-note', 1, { action: 'create', item: fields.item, ...describeChange(undefined, fields) })))
    if (insert) batch.update(guildDoc(db, `lootPriorities/${IDS}`), clean({ ...changes, ...stamp(who, 1) }))
    if (insert && priorityEntry) batch.set(guildDoc(db, `auditLog/${entryId('priority', IDS, 1)}`), clean(entry(who, 'priority', IDS, 1, { item: current?.item, ...describeChange(current, changes) })))
    return batch.commit()
  }

  for (const who of RAID_STAFF as readonly Staff[]) {
    test(`a ${LABEL[who]} records the award to a character who is not on the list and puts that character on a line above the note`, async () => {
      await storeIds()
      await expectAllowed(receive(who, 3))
      const priority = await stored(`lootPriorities/${IDS}`)
      assert.deepEqual(priority?.rankedPlayers, [name(1), name(2), name(3), NOTE])
      assert.deepEqual(priority?.rankedIds, [PLAYER_1, PLAYER_2, PLAYER_3, ''])
      const award = await stored('awards/award-note')
      assert.deepEqual(award?.prioritySnapshot, LINES, 'the snapshot is the list as the council saw it, without the new line')
      assert.deepEqual(award?.prioritySnapshotIds, LINE_IDS)
      assert.equal(award?.recipientId, PLAYER_3)
    })
  }

  test('a snapshot of the new list is refused: the rules read the priority as it stood before the batch', async () => {
    await storeIds()
    await expectDenied(receive('guildLeader', 3, { snapshot: { rankedPlayers: [name(1), name(2), name(3), NOTE], rankedIds: [PLAYER_1, PLAYER_2, PLAYER_3, ''] } }))
  })

  test('the award alone is accepted, and so is the line alone (the rules do not force the pair)', async () => {
    await storeIds()
    await expectAllowed(receive('guildLeader', 3, { insert: false }))
    await storeIds()
    await expectAllowed(editPriority(dbFor('raidLeader'), 'raidLeader', { id: IDS, changes: { rankedPlayers: [name(1), name(2), name(3), NOTE], rankedIds: [PLAYER_1, PLAYER_2, PLAYER_3, ''] } }))
  })

  test('without the entry of the award, or of the line, the whole batch is refused', async () => {
    await storeIds()
    await expectDenied(receive('guildLeader', 3, { awardEntry: false }), 'no entry for the award')
    await expectDenied(receive('guildLeader', 3, { priorityEntry: false }), 'no entry for the line')
  })

  test('a second receipt through the same note, after the first, is accepted and the note moves down again', async () => {
    await storeIds()
    await expectAllowed(receive('guildLeader', 3))
    const db = dbFor('guildLeader')
    const current = await stored(`lootPriorities/${IDS}`)
    const snapshot = { rankedPlayers: current?.rankedPlayers, rankedIds: current?.rankedIds }
    const fields = awardFrom(snapshot, 1, { recipient: name(1), recipientId: PLAYER_1 })
    // the same character again, through the character line they already have
    await expectAllowed(createAward(db, 'guildLeader', { id: 'award-again', fields }))
  })
})

// The widest entries the app can write with these fields. The entry rule may evaluate 1000 expressions in one request (the emulator says "maximum of
// 1000 expressions to evaluate has been reached" and denies), and every field it checks costs some, so these two keep the room honest: a new
// field or check in auditDescribesChange has to leave them passing. See the headroom note above awardFieldsLogged in firestore.rules.
describe('the widest entries these fields make', () => {
  test('a new priority with all ten fields, sixty lines and the longest strings', async () => {
    const fields = newPriorityDoc({
      item: 'x'.repeat(120), encounter: 'x'.repeat(120), councilNote: 'x'.repeat(500), rankedPlayers: names60(), rankedIds: Array.from({ length: 60 }, () => 'x'.repeat(100)),
      itemId: 100_000_000, zoneId: 100_000_000, npcId: 100_000_000, carriedFrom: 'x'.repeat(100),
    })
    await expectAllowed(createPriority(dbFor('guildLeader'), 'guildLeader', { fields }))
  })

  test('a new award from a priority with all eleven fields, sixty lines in the snapshot and the longest strings', async () => {
    const lines = Array.from({ length: 59 }, (_, index) => `line ${index}`)
    await store(IDS, { item: 'x'.repeat(120), encounter: 'x'.repeat(120), councilNote: 'x'.repeat(500), rankedPlayers: [...lines, name(1)], rankedIds: [...lines.map((_, index) => `id-${index}`), PLAYER_1] })
    const fields = awardFrom({ rankedPlayers: [...lines, name(1)], rankedIds: [...lines.map((_, index) => `id-${index}`), PLAYER_1] }, 1, { item: 'x'.repeat(120), encounter: 'x'.repeat(120), councilNoteSnapshot: 'x'.repeat(500), awardNote: 'x'.repeat(500) })
    await expectAllowed(createAward(dbFor('guildLeader'), 'guildLeader', { fields }))
  })
})

describe('what the review found, pinned', () => {
  test('an app from before ids records an award by name from a priority that has ids; with an id but no snapshot ids it is refused', async () => {
    await storeIds()
    await expectAllowed(createAward(dbFor('guildLeader'), 'guildLeader', { fields: awardFrom(stored1Of(), 1, { recipientId: undefined, prioritySnapshotIds: undefined }) }))
    await expectDenied(createAward(dbFor('guildLeader'), 'guildLeader', { id: 'award-two', fields: awardFrom(stored1Of(), 2, { prioritySnapshotIds: undefined }) }), 'an id without the snapshot ids')
  })

  // KNOWN GAPS, pinned on purpose. The rules cannot tell a names-only edit of an app from before ids from a new app's edit of a note's text, so a
  // names-only edit of the same length is accepted and the ids stay as they were. Only an app that was open before this change does that.
  test('KNOWN GAP: a note line replaced by a name (ids left alone) is accepted, and the stale open note then lets any roster character receive', async () => {
    await storeIds()
    await expectAllowed(editPriority(dbFor('guildLeader'), 'guildLeader', { id: IDS, changes: { rankedPlayers: [name(1), name(2), 'Someone Else'] } }))
    await expectAllowed(createAward(dbFor('guildLeader'), 'guildLeader', { fields: awardFrom({ rankedPlayers: [name(1), name(2), 'Someone Else'], rankedIds: LINE_IDS }, 3) }))
  })
  test('KNOWN GAP: a player replaced by another name (ids left alone) keeps the right to receive by id', async () => {
    await storeIds({ rankedPlayers: [name(1), name(2), name(3)], rankedIds: [PLAYER_1, PLAYER_2, PLAYER_3] })
    await expectAllowed(editPriority(dbFor('guildLeader'), 'guildLeader', { id: IDS, changes: { rankedPlayers: [name(2), name(3), 'Newcomer'] } }))
    await expectAllowed(createAward(dbFor('guildLeader'), 'guildLeader', { fields: awardFrom({ rankedPlayers: [name(2), name(3), 'Newcomer'], rankedIds: [PLAYER_1, PLAYER_2, PLAYER_3] }, 1) }))
  })
  test('KNOWN GAP: a finished note replaced by a name (ids left alone) is accepted', async () => {
    await storeIds({ rankedIds: [PLAYER_1, PLAYER_2, '!'] })
    await expectAllowed(editPriority(dbFor('guildLeader'), 'guildLeader', { id: IDS, changes: { rankedPlayers: [name(1), name(2), 'Replaced'] } }))
  })

  test('an entry labelled reorder has to be a permutation: no id or name replaced, none added or taken off', async () => {
    await storeIds()
    const reorder = (changes: Record<string, unknown>, extra: Parameters<typeof editPriority>[2] = {}) => editPriority(dbFor('guildLeader'), 'guildLeader', { id: IDS, action: 'reorder', changes, ...extra })
    await expectDenied(reorder({ rankedPlayers: [name(2), name(1), NOTE], rankedIds: ['', PLAYER_1, ''] }), 'an id replaced by an open note')
    await expectDenied(reorder({ rankedPlayers: [name(2), name(1), 'Other text'], rankedIds: [PLAYER_2, PLAYER_1, ''] }), 'a name replaced')
    await expectDenied(reorder({ rankedPlayers: [name(2), name(1)], rankedIds: [PLAYER_2, PLAYER_1] }), 'a line taken off')
    await expectAllowed(reorder({ rankedPlayers: [name(2), NOTE, name(1)], rankedIds: [PLAYER_2, '', PLAYER_1] }))
  })
  test('a reorder of a list with a person twice is a permutation too', async () => {
    await storeIds({ rankedPlayers: [name(1), name(2), name(1)], rankedIds: [PLAYER_1, PLAYER_2, PLAYER_1] })
    await expectAllowed(editPriority(dbFor('guildLeader'), 'guildLeader', { id: IDS, action: 'reorder', changes: { rankedPlayers: [name(1), name(1), name(2)], rankedIds: [PLAYER_1, PLAYER_1, PLAYER_2] } }))
  })
})

describe('an award edit keeps the recipient id and the recipient name together', () => {
  const store = (overrides: Record<string, unknown> = {}) => asAdmin((db) => setDoc(guildDoc(db, 'awards/award-1'), clean(stampedAward({ rev: 1, phaseNo: 0, recipient: name(1), recipientId: PLAYER_1, ...overrides }))))
  const edit = (changes: Record<string, unknown>, rev = 2) => editAward(dbFor('guildLeader'), 'guildLeader', { changes, rev })

  test('the recipient can be corrected to another roster character when both change together', async () => {
    await store()
    await expectAllowed(edit({ recipient: name(2), recipientId: PLAYER_2 }))
  })
  test('an id that is not the roster\'s id for that name, or not on the roster at all, is refused', async () => {
    await store()
    await expectDenied(edit({ recipientId: PLAYER_2 }), 'another character\'s id, the name unchanged')
    await expectDenied(edit({ recipient: name(2) }), 'another name, the id unchanged')
    await expectDenied(edit({ recipient: name(2), recipientId: PLAYER_3 }), 'a name and id that do not belong together')
    await expectDenied(edit({ recipient: 'Nobody', recipientId: 'player-99' }), 'an id not on the roster')
    await expectDenied(edit({ recipient: name(2), recipientId: 'x/y' }), 'an id that is not an id')
    await asAdmin((db) => setDoc(guildDoc(db, 'roster/guest.1'), rosterDoc(9, { name: 'Guest Nine' })))
    await expectDenied(edit({ recipient: 'Guest Nine', recipientId: 'guest.1' }), 'an id of a shape the app never makes, though the roster has it')
  })
  test('an old award gets its id when the name is the roster\'s, and not otherwise', async () => {
    await store({ recipientId: undefined })
    await expectAllowed(edit({ recipientId: PLAYER_1 }))
    await store({ recipientId: undefined })
    await expectDenied(edit({ recipientId: PLAYER_2 }, 2), 'an id for another name')
  })
  test('other fields can be corrected while the recipient is untouched, even after the character was renamed', async () => {
    await store()
    await asAdmin((db) => setDoc(guildDoc(db, `roster/${PLAYER_1}`), rosterDoc(1, { name: 'Renamed One' })))
    await expectAllowed(edit({ awardNote: 'Corrected note' }))
  })
})
