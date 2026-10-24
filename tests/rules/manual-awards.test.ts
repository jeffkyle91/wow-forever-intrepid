// Manual awards: the awards create rule when there is no priority (validManualAward), and the audit rules for the new
// `decision` field. A manual award records who got an item without a priority list, for example a need-before-greed roll
// on the first raid night (LOOT-002). It carries no priorityId and no snapshot, so it never pretends a candidate order
// existed. The recipient is a roster character by id, and the audit entry has to be written in the same batch.
// See docs/design/audit-first-loot.md.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteField, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
import { LABEL, PERSONAS, PLAYER_2, PLAYER_3, RAID_STAFF, UID, rosterDoc, without } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, stored, setUpGuildEmulator } from './support/harness.ts'
import { MANUAL, clean, createManualAward, describeChange, editAward, entry, entryId, manualAwardDoc, type Staff } from './support/audit.ts'
import { encounterOf, manualAward } from '../../src/features/loot/manualAward.ts'
import { awardCreateFields, describeCreate, manualAwardCreateFields } from '../../src/shared/game/lootAudit.ts'

setUpGuildEmulator()

/** Put the guild in phase `n`: n finished phases in its settings (none stored means phase 0). */
const inPhase = (n: number) => asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { currentPhase: `Phase ${n}`, nextPhase: 'Next', phaseHistory: Array.from({ length: n }, (_, index) => `Earlier ${index}`) }))

for (const who of RAID_STAFF as readonly Staff[]) {
  describe(`a ${LABEL[who]} records a manual award`, () => {
    test('an award with its audit entry is accepted, and nothing in it claims a priority', async () => {
      await expectAllowed(createManualAward(dbFor(who), who))
      const award = await stored(`awards/${MANUAL}`)
      assert.equal(award?.recipientId, PLAYER_2)
      assert.equal(award?.recipient, rosterDoc(2).name)
      assert.equal(award?.decision, 'roll')
      assert.equal(award?.rev, 1)
      assert.equal(award?.createdBy, UID[who])
      assert.ok(award?.createdAt)
      assert.deepEqual(['priorityId', 'prioritySnapshot', 'councilNoteSnapshot', 'status'].filter((key) => key in (award ?? {})), [])
      const logged = await stored(`auditLog/${entryId('award', MANUAL, 1)}`)
      assert.equal(logged?.action, 'create')
      assert.equal(logged?.by, UID[who])
      assert.equal(logged?.item, 'Test Sword')
    })

    for (const decision of ['roll', 'council', 'other']) {
      test(`a decision of "${decision}" is accepted`, async () => {
        await expectAllowed(createManualAward(dbFor(who), who, { fields: manualAwardDoc({ decision }) }))
      })
    }

    test('an empty boss and an empty note are accepted, and so is another roster character', async () => {
      await expectAllowed(createManualAward(dbFor(who), who, { fields: manualAwardDoc({ encounter: '', awardNote: '', recipient: rosterDoc(3).name, recipientId: PLAYER_3 }) }))
    })

    test('the raid date is kept apart from the time of entry', async () => {
      await expectAllowed(createManualAward(dbFor(who), who, { fields: manualAwardDoc({ awardedAt: '2026-12-09' }) }))
      const award = await stored(`awards/${MANUAL}`)
      assert.equal(award?.awardedAt, '2026-12-09')
      assert.notEqual(String(award?.createdAt), '2026-12-09')
    })
  })
}

// match /awards/{awardId}: create, for everyone who is not a Guild or Raid Leader of this guild
describe('nobody else can record a manual award', () => {
  for (const who of PERSONAS.filter((persona) => !RAID_STAFF.includes(persona))) {
    test(`${LABEL[who]} is refused`, async () => {
      // The entry is written as a leader would, so the refusal comes from the award rule, not from a wrong entry.
      await expectDenied(createManualAward(dbFor(who), 'raidLeader'))
    })
  }
})

// The audit entry is what makes the award real: each needs the other, and the entry has to say what happened.
describe('the audit entry of a manual award', () => {
  test('an award without an entry is refused', async () => {
    await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { skipEntry: true }))
  })

  const wrongEntries: [string, Parameters<typeof createManualAward>[2]][] = [
    ['an entry filed under another award', { entryKey: entryId('award', 'award-other', 1) }],
    ['an entry filed at revision 2', { entryKey: entryId('award', MANUAL, 2), audit: { rev: 2 } }],
    ['an entry that says it is an edit', { audit: { action: 'edit' } }],
    ['an entry for a priority with the same id', { entryKey: entryId('priority', MANUAL, 1), audit: { targetType: 'priority' } }],
    ['an entry that names the wrong item', { audit: { item: 'Another Item' } }],
    ['an entry that lists a different recipient', { audit: { after: { ...manualAwardDoc(), recipient: 'Someone Else' } } }],
    ['an entry that lists a different decision', { audit: { after: { ...manualAwardDoc(), decision: 'council' } } }],
    ['an entry that leaves a field out of the changes', { audit: { changed: ['item', 'encounter', 'recipient', 'recipientId', 'awardedAt', 'awardNote'] } }],
    ['an entry written by someone else', { audit: { by: UID.guildLeader } }],
  ]
  for (const [what, options] of wrongEntries) {
    test(`${what} is refused`, async () => {
      await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', options))
    })
  }
})

// Only the listed fields, and nothing that would pass the award off as decided from a priority.
describe('the shape of a manual award', () => {
  // Each extra is written into the award and described honestly by the entry wherever the entry may list that field, so what
  // refuses it is the award rule's own list of fields, not a mismatch with the entry.
  const extras: [string, Record<string, unknown>][] = [
    ['a priorityId', { priorityId: 'priority-1' }],
    ['a prioritySnapshot', { prioritySnapshot: [PLAYER_2] }],
    ['a councilNoteSnapshot', { councilNoteSnapshot: 'A note that never existed' }],
    ['a status', { status: 'active' }],
    ['a removedReason', { removedReason: 'x' }],
  ]
  for (const [what, extra] of extras) {
    test(`an award with ${what} is refused`, async () => {
      await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { fields: manualAwardDoc(extra) }))
    })
  }
  test('an award with updatedBy and updatedAt is refused', async () => {
    await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { award: { updatedBy: UID.raidLeader, updatedAt: serverTimestamp() } }))
  })
  test('an award with an unknown field is refused', async () => {
    await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { fields: manualAwardDoc({ extra: 'anything' }) }))
  })

  for (const field of ['item', 'encounter', 'recipient', 'recipientId', 'awardedAt', 'awardNote', 'decision', 'phaseNo']) {
    test(`an award with no ${field} is refused`, async () => {
      await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { fields: without(manualAwardDoc(), field) }))
    })
  }

  const bad: [string, Record<string, unknown>][] = [
    ['an empty item', { item: '' }],
    ['an item over 120 characters', { item: 'x'.repeat(121) }],
    ['an item that is not text', { item: 5 }],
    ['an encounter over 120 characters', { encounter: 'x'.repeat(121) }],
    ['an empty recipient', { recipient: '' }],
    ['a recipient over 60 characters', { recipient: 'x'.repeat(61) }],
    ['a date that is not a date', { awardedAt: 'last Tuesday' }],
    ['a date that is a number', { awardedAt: 20261209 }],
    ['a note over 500 characters', { awardNote: 'x'.repeat(501) }],
    ['a decision that is not one of the three', { decision: 'fiat' }],
    ['a decision with different capitals', { decision: 'Roll' }],
    ['a decision that is a list', { decision: ['roll'] }],
    ['a phase of -1', { phaseNo: -1 }],
    ['a phase of 1.5', { phaseNo: 1.5 }],
    ['a phase that is text', { phaseNo: '0' }],
    ['a phase that is empty', { phaseNo: null }],
    ['a phase of 31', { phaseNo: 31 }],
    ['a phase of 2 to the power of 60', { phaseNo: 2 ** 60 }],
  ]
  for (const [what, overrides] of bad) {
    test(`an award with ${what} is refused`, async () => {
      await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { fields: manualAwardDoc(overrides) }))
    })
  }

  // A manual award is recorded in the current phase, which is the number of finished phases in the settings (none stored means phase 0).
  const record = (phaseNo: number, id = MANUAL) => createManualAward(dbFor('raidLeader'), 'raidLeader', { id, fields: manualAwardDoc({ phaseNo }) })

  test('a manual award is recorded in the current phase: 0 when no phase has been closed, then the number of finished phases', async () => {
    await expectAllowed(record(0, 'manual-a'), 'phase 0, with no settings stored')
    await inPhase(0)
    await expectAllowed(record(0, 'manual-b'), 'phase 0, with the settings stored')
    await inPhase(2)
    await expectAllowed(record(2, 'manual-c'), 'phase 2')
    await inPhase(30)
    await expectAllowed(record(30, 'manual-d'), 'phase 30, the highest')
  })

  test('a manual award in a finished phase, or in the next one, is refused', async () => {
    await inPhase(2)
    for (const phaseNo of [0, 1, 3]) await expectDenied(record(phaseNo), `phase ${phaseNo} while the current phase is 2`)
    await expectAllowed(record(2), 'the current phase')
  })

  test('the phase of a manual award follows the settings: a closed phase cannot be recorded into', async () => {
    await expectAllowed(record(0, 'manual-a'))
    await inPhase(1)
    await expectDenied(record(0, 'manual-b'), 'phase 0 once it is finished')
  })

  test('the longest allowed values are accepted', async () => {
    await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader', { fields: manualAwardDoc({ item: 'x'.repeat(120), encounter: 'x'.repeat(120), awardNote: 'x'.repeat(500) }) }))
  })
})

// The stamps are set by the rules' own checks, never by the client's say-so.
describe('the stamps of a manual award', () => {
  const stamps: [string, Record<string, unknown>][] = [
    ['a revision other than 1', { rev: 2 }],
    ['a revision that is text', { rev: '1' }],
    ['a revision of 1.5', { rev: 1.5 }],
    ['someone else as the creator', { createdBy: UID.guildLeader }],
    ['a creation time from the client', { createdAt: new Date('2026-01-01T00:00:00Z') }],
    ['a creation time that is text', { createdAt: 'now' }],
  ]
  for (const [what, award] of stamps) {
    test(`an award with ${what} is refused`, async () => {
      await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { award }))
    })
  }
})

// The recipient is a character on this guild's roster, and the name is the roster's name.
describe('the recipient of a manual award', () => {
  test('an id that is not on the roster is refused', async () => {
    await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { fields: manualAwardDoc({ recipientId: 'player-404' }) }))
  })

  test('a name that is not the roster name for that id is refused', async () => {
    await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { fields: manualAwardDoc({ recipient: rosterDoc(3).name }) }))
    await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { fields: manualAwardDoc({ recipient: `${rosterDoc(2).name} ` }) }))
  })

  const ids: [string, unknown][] = [
    ['an id with a slash in it', 'player-2/extra'],
    ['an id with dots in it', '../roster/player-2'],
    ['an id that is a number', 2],
    ['an id that is empty', ''],
    ['an id over 100 characters', 'x'.repeat(101)],
  ]
  for (const [what, recipientId] of ids) {
    test(`${what} is refused`, async () => {
      await expectDenied(createManualAward(dbFor('raidLeader'), 'raidLeader', { fields: manualAwardDoc({ recipientId }) }))
    })
  }
})

// A manual award is corrected like any other, with an entry, and the new field is part of what the entry has to log.
for (const who of RAID_STAFF as readonly Staff[]) {
  describe(`a ${LABEL[who]} corrects a manual award`, () => {
    test('changing the decision, with its entry, is accepted and logged', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await expectAllowed(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { decision: 'council' } }))
      const logged = await stored(`auditLog/${entryId('award', MANUAL, 2)}`)
      assert.deepEqual(logged?.changed, ['decision'])
      assert.deepEqual(logged?.before, { decision: 'roll' })
      assert.deepEqual(logged?.after, { decision: 'council' })
    })

    test('changing the decision without logging it is refused', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { decision: 'council' }, audit: { changed: [], before: {}, after: {} } }))
    })

    test('an entry that lies about the old or the new decision is refused', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { decision: 'council' }, audit: { before: { decision: 'other' } } }), 'a wrong old value')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { decision: 'council' }, audit: { after: { decision: 'other' } } }), 'a wrong new value')
    })

    test('a decision that is not one of the three is refused', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { decision: 'fiat' } }))
    })

    test('correcting the phase to a phase that has started, with its entry, is accepted and logged', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await inPhase(1)
      await expectAllowed(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { phaseNo: 1 } }))
      const logged = await stored(`auditLog/${entryId('award', MANUAL, 2)}`)
      assert.deepEqual(logged?.changed, ['phaseNo'])
      assert.deepEqual(logged?.before, { phaseNo: 0 })
      assert.deepEqual(logged?.after, { phaseNo: 1 })
    })

    test('an award cannot be moved to a phase that has not started', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { phaseNo: 1 } }), 'the next phase')
      await inPhase(1)
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { phaseNo: 2 } }), 'one past the current phase')
      await expectAllowed(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { phaseNo: 1 } }), 'the current phase')
    })

    test('changing the phase without logging it, or with an entry that lies, is refused', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await inPhase(1)
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { phaseNo: 1 }, audit: { changed: [], before: {}, after: {} } }), 'not logged')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { phaseNo: 1 }, audit: { before: { phaseNo: 5 } } }), 'a wrong old value')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { phaseNo: 1 }, audit: { after: { phaseNo: 2 } } }), 'a wrong new value')
    })

    test('a phase that is not a whole number of 0 or more is refused', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      for (const phaseNo of [-1, 0.5, '1', 31]) await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { phaseNo } }), JSON.stringify(phaseNo))
    })

    test('a correction cannot take the phase number away', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { phaseNo: deleteField(), awardNote: 'Edited' }, audit: { changed: ['phaseNo', 'awardNote'], before: { phaseNo: 0, awardNote: '' }, after: { phaseNo: null, awardNote: 'Edited' } } }))
    })

    test('changing the recipient to another roster character is accepted', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await expectAllowed(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { recipient: rosterDoc(3).name, recipientId: PLAYER_3 } }))
    })

    test('removing it needs a reason, and is then accepted', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { status: 'removed' }, audit: { action: 'remove' } }), 'no reason')
      await expectAllowed(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { status: 'removed', removedReason: 'Entered by mistake' }, audit: { action: 'remove', reason: 'Entered by mistake' } }), 'with a reason')
    })

    test('it cannot be turned into a priority award afterwards', async () => {
      await expectAllowed(createManualAward(dbFor('raidLeader'), 'raidLeader'), 'recording it')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { priorityId: 'priority-1' } }), 'a priorityId')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { prioritySnapshot: [PLAYER_2] } }), 'a snapshot')
      await expectDenied(editAward(dbFor(who), who, { awardId: MANUAL, rev: 2, changes: { councilNoteSnapshot: 'Invented later' } }), 'a council note')
    })
  })
}

// How many manual awards, each with its entry, one batch can hold. Firestore limits the document lookups the rules may
// make in a batch to 20. A lookup of a document already looked up in the batch is not charged again, so awards for one
// recipient share the roster lookup, and each different recipient costs one more. What these tests pin is the emulator's
// count; whether production counts identically is not verified. A bulk upload (LOOT-005) therefore has to send its awards
// in chunks smaller than this, and a change to the rules that adds lookups can move these limits, which is what the tests are for.
describe('how many manual awards fit in one batch', () => {
  const batchOf = (db: Firestore, count: number, recipients: number) => {
    const batch = writeBatch(db)
    for (let i = 0; i < count; i++) {
      const who = i % recipients
      const id = `award-batch-${i}`
      const fields = manualAwardDoc({ recipientId: `batch-${who}`, recipient: rosterDoc(`batch-${who}`).name })
      batch.set(guildDoc(db, `awards/${id}`), clean({ ...fields, rev: 1, createdBy: UID.raidLeader, createdAt: serverTimestamp() }))
      batch.set(guildDoc(db, `auditLog/${entryId('award', id, 1)}`), clean(entry('raidLeader', 'award', id, 1, { action: 'create', item: fields.item, ...describeChange(undefined, fields) })))
    }
    return batch.commit()
  }
  const seedRoster = (count: number) => asAdmin(async (db) => { for (let i = 0; i < count; i++) await setDoc(guildDoc(db, `roster/batch-${i}`), rosterDoc(`batch-${i}`)) })

  // With the settings stored, as for any guild that has saved them: the loot phase check looks them up, two lookups for the whole batch.
  const settings = () => asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { currentPhase: 'Phase', nextPhase: 'Next', phaseHistory: [] }))

  test('15 awards for one recipient fit', async () => {
    await settings()
    await seedRoster(1)
    await expectAllowed(batchOf(dbFor('raidLeader'), 15, 1))
  })

  test('16 awards for one recipient do not', async () => {
    await settings()
    await seedRoster(1)
    await expectDenied(batchOf(dbFor('raidLeader'), 16, 1))
  })

  test('8 awards for 8 different recipients fit', async () => {
    await settings()
    await seedRoster(8)
    await expectAllowed(batchOf(dbFor('raidLeader'), 8, 8))
  })

  test('9 awards for 9 different recipients do not', async () => {
    await settings()
    await seedRoster(9)
    await expectDenied(batchOf(dbFor('raidLeader'), 9, 9))
  })
})

// What the app itself sends. The award is built by the Record loot form's own function (features/loot/manualAward.ts) and its entry is described with the field list
// guildApi.recordManualAward uses (manualAwardCreateFields), so the rules run against the app's payload and not a hand-kept copy of it (LOOT-002).
describe('the award the Record loot form builds', () => {
  const roster = { player: (id: string) => (id === PLAYER_2 ? { id: PLAYER_2, name: rosterDoc(2).name } : undefined) }
  const built = manualAward({ item: 'Test Sword', dungeon: 'Test Hall', boss: '', recipientId: PLAYER_2, awardedAt: '2026-12-09', decision: 'council', awardNote: '  Both rolled  ' }, roster, 0).award!

  /** One batch as recordManualAward writes it: the award with its stamps, and the create entry that lists the fields with the given list. */
  const writeAsTheAppDoes = (db: Firestore, who: Staff, fieldList: readonly string[]) => {
    const batch = writeBatch(db)
    batch.set(guildDoc(db, `awards/${MANUAL}`), { ...built, rev: 1, createdBy: UID[who], createdAt: serverTimestamp() })
    batch.set(guildDoc(db, `auditLog/${entryId('award', MANUAL, 1)}`), clean(entry(who, 'award', MANUAL, 1, { action: 'create', item: built.item, ...describeCreate(built, fieldList) })))
    return batch.commit()
  }

  for (const who of RAID_STAFF as readonly Staff[]) {
    test(`is accepted from a ${LABEL[who]}, with its entry, exactly as the app writes it`, async () => {
      await expectAllowed(writeAsTheAppDoes(dbFor(who), who, manualAwardCreateFields))
      const award = await stored(`awards/${MANUAL}`)
      assert.deepEqual({ ...award, createdAt: undefined }, { ...built, rev: 1, createdBy: UID[who], createdAt: undefined })
      const logged = await stored(`auditLog/${entryId('award', MANUAL, 1)}`)
      assert.equal(logged?.action, 'create')
      assert.deepEqual([...(logged?.changed ?? [])].sort(), [...manualAwardCreateFields].sort())
      assert.equal(logged?.after.decision, 'council')
      assert.equal(logged?.after.awardNote, 'Both rolled')
      assert.equal(award?.encounter, 'Test Hall \u00b7', 'a dungeon with no boss is kept as the dungeon and a separator')
    })
  }

  // Every shape the form's place can take is plain text to the rules (at most 120 characters), and the Log reads each one back as the dungeon and boss it was picked with.
  for (const place of [{ dungeon: 'Test Hall', boss: 'Hall Warden' }, { dungeon: '', boss: '' }]) {
    test(`is accepted with the place ${JSON.stringify(encounterOf(place.dungeon, place.boss))}`, async () => {
      const award = manualAward({ item: 'Test Sword', ...place, recipientId: PLAYER_2, awardedAt: '2026-12-09', decision: 'roll', awardNote: '' }, roster, 0).award!
      const batch = writeBatch(dbFor('raidLeader'))
      batch.set(guildDoc(dbFor('raidLeader'), `awards/${MANUAL}`), { ...award, rev: 1, createdBy: UID.raidLeader, createdAt: serverTimestamp() })
      batch.set(guildDoc(dbFor('raidLeader'), `auditLog/${entryId('award', MANUAL, 1)}`), clean(entry('raidLeader', 'award', MANUAL, 1, { action: 'create', item: award.item, ...describeCreate(award, manualAwardCreateFields) })))
      await expectAllowed(batch.commit())
      assert.equal((await stored(`awards/${MANUAL}`))?.encounter, encounterOf(place.dungeon, place.boss))
    })
  }

  test('is refused when its entry is described with the field list of an award from a priority, which has no decision (the trap the separate list avoids)', async () => {
    await expectDenied(writeAsTheAppDoes(dbFor('raidLeader'), 'raidLeader', awardCreateFields), 'an entry that leaves the decision out')
  })

  test('is refused for a character who is not on the roster, whatever name is written', async () => {
    const stranger = manualAward({ item: 'Test Sword', dungeon: '', boss: '', recipientId: 'player-nobody', awardedAt: '2026-12-09', decision: 'roll', awardNote: '' }, { player: () => ({ id: 'player-nobody', name: 'Nobody Known' }) }, 0).award!
    const batch = writeBatch(dbFor('raidLeader'))
    batch.set(guildDoc(dbFor('raidLeader'), `awards/${MANUAL}`), { ...stranger, rev: 1, createdBy: UID.raidLeader, createdAt: serverTimestamp() })
    await expectDenied(batch.commit(), 'a recipient the roster does not have')
  })

  test('is refused in a phase other than the current one', async () => {
    const elsewhere = { ...built, phaseNo: 4 }
    const batch = writeBatch(dbFor('guildLeader'))
    batch.set(guildDoc(dbFor('guildLeader'), `awards/${MANUAL}`), { ...elsewhere, rev: 1, createdBy: UID.guildLeader, createdAt: serverTimestamp() })
    batch.set(guildDoc(dbFor('guildLeader'), `auditLog/${entryId('award', MANUAL, 1)}`), clean(entry('guildLeader', 'award', MANUAL, 1, { action: 'create', item: elsewhere.item, ...describeCreate(elsewhere, manualAwardCreateFields) })))
    await expectDenied(batch.commit(), 'a phase that is not the current one')
  })
})
