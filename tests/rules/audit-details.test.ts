// Audit log, in detail: the old and new value an entry has to give for every field it can list, awards and priorities
// being created, edited and deleted with their entries, the 120-character item label, entry ids, and the cases where
// one rule line is the only thing standing in the way. The main behaviour is in audit.test.ts; the builders for
// both files are in support/audit.ts.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, deleteField, setDoc, writeBatch, type DocumentData } from 'firebase/firestore'
import { AWARD, NOTHING, createAward, createPriority, deletePriority, describeChange, editAward, editPriority, entry, entryId, removedAward, stampedAward, type Staff } from './support/audit.ts'
import { LABEL, PLAYER_1, PLAYER_2, PLAYER_3, PRIORITY_ID, RAID_STAFF, UID, awardDoc, displayNameOf, priorityDoc } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, stored, setUpGuildEmulator } from './support/harness.ts'
import { asDouble, rawCommit, requestTime } from './support/raw.ts'

setUpGuildEmulator()

const WHO: Staff = 'raidLeader'

// ---------------------------------------------------------------------------------------------------------------
describe('awards: delete, roles and frozen fields', () => {
  test('[R09] a removed award cannot be deleted either, by any leader', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'awards/award-removed'), removedAward()))
    for (const who of RAID_STAFF as readonly Staff[]) await expectDenied(deleteDoc(guildDoc(dbFor(who), 'awards/award-removed')), `a ${LABEL[who]} deleting a removed award`)
    assert.ok(await stored('awards/award-removed'), 'the removed award is still there')
  })

  // The entry lists only what the log can show, and createdBy/createdAt are not in the list, so only unchanged() stops these.
  test('[U1-createdBy,U1-createdAt] who created an award and when cannot be rewritten behind an entry that says nothing changed', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'awards/award-2'), stampedAward()))
    const db = dbFor(WHO)
    await expectDenied(editAward(db, WHO, { awardId: 'award-2', rev: 4, changes: { createdBy: UID.member }, audit: NOTHING }), 'another creator')
    await expectDenied(editAward(db, WHO, { awardId: 'award-2', rev: 4, changes: { createdAt: new Date('2026-01-01T00:00:00Z') }, audit: NOTHING }), 'another creation time')
    await expectAllowed(editAward(db, WHO, { awardId: 'award-2', rev: 4 }), 'a plain edit of the stamped award')
  })

  test('[U05,U01] an award that has no creator cannot be given one, not even as null, behind an entry that says nothing changed', async () => {
    const db = dbFor(WHO)
    await expectDenied(editAward(db, WHO, { changes: { createdBy: UID[WHO] }, audit: NOTHING }), 'a creator on an award that had none')
    await expectDenied(editAward(db, WHO, { changes: { createdAt: new Date('2026-01-01T00:00:00Z') }, audit: NOTHING }), 'a creation time on an award that had none')
    await expectDenied(editAward(db, WHO, { changes: { createdBy: null }, audit: NOTHING }), 'createdBy: null on an award without the field')
    await expectDenied(editAward(db, WHO, { changes: { createdAt: null }, audit: NOTHING }), 'createdAt: null on an award without the field')
  })

  test('[U01] a createdBy of null cannot be deleted, so "has a null creator" and "has no creator" stay different', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'awards/award-2'), awardDoc({ rev: 1, createdBy: null })))
    await expectDenied(editAward(dbFor(WHO), WHO, { awardId: 'award-2', rev: 2, changes: { createdBy: deleteField() }, audit: NOTHING }))
  })

  for (const field of ['priorityId', 'prioritySnapshot', 'councilNoteSnapshot'] as const) {
    test(`[U2-${field}] the ${field} cannot be deleted or nulled, even when the entry says so truthfully`, async () => {
      const original = awardDoc()[field]
      const truthful = { changed: [field], before: { [field]: original }, after: { [field]: null } }
      for (const what of ['deleted', 'set to null'] as const) {
        await expectDenied(editAward(dbFor(WHO), WHO, { changes: { [field]: what === 'deleted' ? deleteField() : null }, audit: truthful }), `${field} ${what}`)
      }
      assert.deepEqual((await stored(`awards/${AWARD}`))?.[field], original)
    })
  }
})

// ---------------------------------------------------------------------------------------------------------------
describe('awards: a stored field the rule does not know', () => {
  for (const key of ['favourite', 'legacyNote']) {
    test(`[A05,A06,A08] an award that carries an unknown stored field (${key}) cannot be edited`, async () => {
      await asAdmin((db) => setDoc(guildDoc(db, 'awards/award-legacy'), awardDoc({ [key]: 'x' })))
      await expectDenied(editAward(dbFor(WHO), WHO, { awardId: 'award-legacy' }))
      await expectDenied(editAward(dbFor(WHO), WHO, { awardId: 'award-legacy', changes: { [key]: deleteField() }, audit: { changed: [key], before: { [key]: 'x' }, after: { [key]: null } } }), 'dropping the unknown field in an edit the entry cannot describe')
    })
  }
})

// ---------------------------------------------------------------------------------------------------------------
describe('awards: editing an award that is already removed', () => {
  test('[A44,A46,A47] it stays removed only with a real reason, and may still be corrected', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'awards/award-removed'), removedAward()))
    const db = dbFor(WHO)
    const edit = (changes: DocumentData, audit: DocumentData = {}) => editAward(db, WHO, { awardId: 'award-removed', rev: 2, changes, audit })
    await expectDenied(edit({ removedReason: '' }), 'an empty reason')
    await expectDenied(edit({ removedReason: '   ' }), 'a reason of spaces')
    await expectDenied(edit({ removedReason: deleteField() }, { changed: ['removedReason'], before: { removedReason: 'Entered by mistake' }, after: { removedReason: null } }), 'no reason')
    await expectDenied(edit({ removedReason: ['Entered by mistake'] }), 'a reason that is a list')
    await expectDenied(edit({ removedReason: 'x'.repeat(301) }), 'a reason over 300 characters')
    await expectAllowed(edit({ removedReason: 'Entered twice' }), 'a new reason')
    assert.equal((await stored('awards/award-removed'))?.removedReason, 'Entered twice')
  })

  test('[D29] a plain correction of a removed award is logged as an edit, not as another removal', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'awards/award-removed'), removedAward()))
    const db = dbFor(WHO)
    await expectDenied(editAward(db, WHO, { awardId: 'award-removed', rev: 2, changes: { awardNote: 'Fixed typo' }, audit: { action: 'remove', reason: 'Entered by mistake' } }), 'an edit logged as a removal')
    await expectAllowed(editAward(db, WHO, { awardId: 'award-removed', rev: 2, changes: { awardNote: 'Fixed typo' } }), 'the same edit logged as an edit')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// audit.test.ts only lies about `recipient` (awards) and `rankedPlayers` (priorities). Every other field the entry lists
// has its own auditFieldLogged line, so each needs its own check that the entry's old and new values are the stored ones.
const lied = (honest: DocumentData, side: 'before' | 'after', field: string): DocumentData => ({ [side]: { ...honest[side], [field]: 'a lie' } })

describe('an award edit entry must give the stored old value and the stored new value of every field it lists', () => {
  const plain: [string, DocumentData][] = [
    ['item', { item: 'Corrected Sword' }],
    ['encounter', { encounter: 'Corrected Boss' }],
    ['recipientId', { recipientId: 'roster-1' }],
    ['awardedAt', { awardedAt: '2026-12-10' }],
    ['awardNote', { awardNote: 'Swapped gear' }],
  ]
  for (const [field, changes] of plain) {
    test(`[F1-${field}] ${field}`, async () => {
      const db = dbFor(WHO)
      const honest = describeChange(awardDoc(), changes)
      await expectDenied(editAward(db, WHO, { changes, audit: lied(honest, 'before', field) }), `a wrong old ${field}`)
      await expectDenied(editAward(db, WHO, { changes, audit: lied(honest, 'after', field) }), `a wrong new ${field}`)
      await expectAllowed(editAward(db, WHO, { changes }), `the honest entry for ${field}`)
    })
  }

  test('[F1-status,F1-removedReason] a removal', async () => {
    const db = dbFor(WHO)
    const changes = { status: 'removed', removedReason: 'Gear was swapped' }
    const honest = { action: 'remove', reason: 'Gear was swapped', ...describeChange(awardDoc(), changes) }
    for (const field of ['status', 'removedReason']) {
      await expectDenied(editAward(db, WHO, { changes, audit: { ...honest, ...lied(honest, 'before', field) } }), `a wrong old ${field}`)
      await expectDenied(editAward(db, WHO, { changes, audit: { ...honest, ...lied(honest, 'after', field) } }), `a wrong new ${field}`)
    }
    await expectAllowed(editAward(db, WHO, { changes, audit: honest }), 'the honest removal entry')
  })

  test('[F1-status] restoring a removed award logs the old status as removed', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'awards/award-removed'), removedAward()))
    const db = dbFor(WHO)
    const changes = { status: 'active' }
    const honest = describeChange(removedAward(), changes)
    await expectDenied(editAward(db, WHO, { awardId: 'award-removed', rev: 2, changes, audit: { before: { status: null } } }), 'an old status that was not the stored one')
    await expectDenied(editAward(db, WHO, { awardId: 'award-removed', rev: 2, changes, audit: lied(honest, 'after', 'status') }), 'a new status that is not the stored one')
    await expectAllowed(editAward(db, WHO, { awardId: 'award-removed', rev: 2, changes }), 'the honest entry')
  })
})

describe('an award create entry', () => {
  const fields = awardDoc()
  const listed = Object.keys(fields) // priorityId, item, encounter, recipient, awardedAt, prioritySnapshot, councilNoteSnapshot, awardNote

  for (const who of RAID_STAFF as readonly Staff[]) {
    test(`[D04-*,D10-createdBy,D10-createdAt,D11-*] a ${LABEL[who]} can create an award with an entry that lists its fields`, async () => {
      await expectAllowed(createAward(dbFor(who), who))
      const logged = await stored(`auditLog/${entryId('award', 'award-new', 1)}`)
      assert.equal(logged?.action, 'create')
      assert.deepEqual([...((logged?.changed ?? []) as string[])].sort(), [...listed].sort())
      assert.deepEqual((logged?.after as DocumentData | undefined)?.prioritySnapshot, fields.prioritySnapshot)
    })
  }

  for (const field of listed) {
    test(`[F1-${field}] ${field}: the entry cannot give another old or new value, or leave the field out`, async () => {
      const db = dbFor(WHO)
      const honest = describeChange(undefined, fields)
      await expectDenied(createAward(db, WHO, { audit: lied(honest, 'before', field) }), `a made-up old ${field}`)
      await expectDenied(createAward(db, WHO, { audit: lied(honest, 'after', field) }), `a wrong new ${field}`)
      const others = listed.filter((key) => key !== field)
      await expectDenied(createAward(db, WHO, { audit: { changed: others, before: Object.fromEntries(others.map((k) => [k, null])), after: Object.fromEntries(others.map((k) => [k, fields[k]])) } }), `an entry that leaves ${field} out`)
    })
  }

  test('[D13,D08] a field the log cannot describe makes the create entry refused, even when the entry lists it', async () => {
    const db = dbFor(WHO)
    for (const extra of [{ surprise: 'x' }, { rankedPlayers: [PLAYER_1] }, { favourite: true }]) {
      const withExtra = { ...fields, ...extra }
      await expectDenied(createAward(db, WHO, { id: 'award-extra', fields: withExtra }), `a created award with ${Object.keys(extra)[0]}`)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------

describe('a priority entry must give the stored old and new value of every field it lists', () => {
  const edits: [string, DocumentData][] = [
    ['item', { item: 'Corrected Sword' }],
    ['encounter', { encounter: 'Corrected Boss' }],
    ['councilNote', { councilNote: 'Rewritten note' }],
  ]
  for (const [field, changes] of edits) {
    test(`[F1-${field}] edit: ${field}`, async () => {
      const db = dbFor(WHO)
      const honest = describeChange(priorityDoc(), changes)
      await expectDenied(editPriority(db, WHO, { changes, audit: lied(honest, 'before', field) }), `a wrong old ${field}`)
      await expectDenied(editPriority(db, WHO, { changes, audit: lied(honest, 'after', field) }), `a wrong new ${field}`)
      await expectAllowed(editPriority(db, WHO, { changes }), `the honest entry for ${field}`)
    })
  }

  for (const field of ['item', 'encounter', 'councilNote']) { // rankedPlayers is already covered by the reorder tests in audit.test.ts
    test(`[F1-${field}] create: ${field}`, async () => {
      const db = dbFor(WHO)
      const honest = describeChange(undefined, priorityDoc())
      await expectDenied(createPriority(db, WHO, { audit: lied(honest, 'before', field) }), `a made-up old ${field}`)
      await expectDenied(createPriority(db, WHO, { audit: lied(honest, 'after', field) }), `a wrong new ${field}`)
      const others = Object.keys(priorityDoc()).filter((key) => key !== field)
      await expectDenied(createPriority(db, WHO, { audit: { changed: others, before: Object.fromEntries(others.map((k) => [k, null])), after: Object.fromEntries(others.map((k) => [k, priorityDoc()[k]])) } }), `an entry that leaves ${field} out`)
    })

    test(`[F1-${field}] delete: ${field}`, async () => {
      const db = dbFor(WHO)
      const honest = { before: priorityDoc() }
      await expectDenied(deletePriority(db, WHO, { audit: lied(honest, 'before', field) }), `a wrong old ${field}`)
      await expectDenied(deletePriority(db, WHO, { audit: { after: { [field]: priorityDoc()[field] } } }), `an entry that says ${field} is still there after the delete`)
      await expectAllowed(deletePriority(db, WHO), `the honest delete entry`)
    })
  }

  test('[V85] a delete entry that lists nothing, or only some of the fields, is refused', async () => {
    const db = dbFor(WHO)
    await expectDenied(deletePriority(db, WHO, { audit: { changed: [], before: {} } }), 'a delete that says nothing was removed')
    await expectDenied(deletePriority(db, WHO, { audit: { changed: ['item'], before: { item: priorityDoc().item } } }), 'a delete that lists one field')
    assert.ok(await stored(`lootPriorities/${PRIORITY_ID}`), 'the priority is still there')
  })
})

describe('a priority entry can only describe the four priority fields', () => {
  const awardOnly: [string, DocumentData][] = [
    ['recipient', { recipient: PLAYER_3 }],
    ['awardNote', { awardNote: 'x' }],
    ['status', { status: 'active' }],
    ['awardedAt', { awardedAt: '2026-12-10' }],
    ['recipientId', { recipientId: 'roster-1' }],
    ['priorityId', { priorityId: 'priority-9' }],
    ['prioritySnapshot', { prioritySnapshot: [PLAYER_1] }],
    ['removedReason', { removedReason: 'x' }],
  ]
  for (const [field, extra] of awardOnly) {
    test(`[D01,D06,D07] a priority edit that also writes ${field} is refused, even though the entry lists it`, async () => {
      await expectDenied(editPriority(dbFor(WHO), WHO, { changes: { item: 'Renamed Sword', ...extra } }))
      await expectAllowed(editPriority(dbFor(WHO), WHO, { changes: { item: 'Renamed Sword' } }), 'the same edit without it')
    })
  }

  test('[D01] a priority created with an award field is refused', async () => {
    await expectDenied(createPriority(dbFor(WHO), WHO, { fields: priorityDoc({ recipient: PLAYER_3 }) }))
  })
})

describe('a reorder entry', () => {
  const reordered = { rankedPlayers: [PLAYER_3, PLAYER_2, PLAYER_1] }
  test('[D38,D39,D40] is for a change of the candidate order and nothing else', async () => {
    const db = dbFor(WHO)
    await expectDenied(editPriority(db, WHO, { changes: { ...reordered, councilNote: 'Rewritten note' }, audit: { action: 'reorder' } }), 'a reorder that also rewrites the council note')
    await expectDenied(editPriority(db, WHO, { changes: { councilNote: 'Rewritten note' }, audit: { action: 'reorder' } }), 'a reorder of nothing but the council note')
    await expectDenied(editPriority(db, WHO, { changes: {}, audit: { action: 'reorder' } }), 'a reorder that changes nothing')
    await expectAllowed(editPriority(db, WHO, { changes: reordered, audit: { action: 'reorder' } }), 'a plain reorder')
  })
  test('the same change is fine as an edit', async () => {
    await expectAllowed(editPriority(dbFor(WHO), WHO, { changes: { ...reordered, councilNote: 'Rewritten note' } }))
  })
})

describe('a priority entry and the priority it describes must agree on the revision', () => {
  test('[V94] the priority cannot be written at another revision than the entry says', async () => {
    const db = dbFor(WHO)
    await expectDenied(editPriority(db, WHO, { priority: { rev: 7 } }), 'revision 7 with an entry for revision 1')
    await expectDenied(editPriority(db, WHO, { priority: { rev: undefined } }), 'no revision at all')
    await expectDenied(editPriority(db, WHO, { priority: { rev: 0 } }), 'revision 0')
    await expectAllowed(editPriority(db, WHO), 'revision 1')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('a removal and its entry', () => {
  test('[D32] an award that stays active cannot be logged as removed, even with a reason that matches its removedReason', async () => {
    await expectDenied(editAward(dbFor(WHO), WHO, { changes: { removedReason: 'Gear was swapped' }, audit: { action: 'remove', reason: 'Gear was swapped' } }))
    await expectAllowed(editAward(dbFor(WHO), WHO, { changes: { removedReason: 'Gear was swapped' } }), 'the same edit logged as an edit')
  })

  test('[D36] the reason in a removal entry is the removedReason itself, not a shorter or different text', async () => {
    const db = dbFor(WHO)
    const removal = { status: 'removed', removedReason: 'Gear was swapped' }
    await expectDenied(editAward(db, WHO, { changes: removal, audit: { action: 'remove', reason: 'Mistake' } }), 'a shorter reason')
    await expectDenied(editAward(db, WHO, { changes: removal, audit: { action: 'remove', reason: 'Gear was swapped!' } }), 'a longer reason')
    await expectDenied(editAward(db, WHO, { changes: removal, audit: { action: 'remove', reason: 'Gear was dropped' } }), 'a reason of the same length')
    await expectAllowed(editAward(db, WHO, { changes: removal, audit: { action: 'remove', reason: 'Gear was swapped' } }), 'the same reason')
  })
})

describe('entry ids, target types and revisions', () => {
  const twin = (): DocumentData => entry(WHO, 'award', AWARD, 1, { item: 'Test Sword', ...describeChange(awardDoc(), { recipient: PLAYER_3 }) })

  test('[V29,V32,V33,V34] a second, matching entry for the same change under any other id is refused', async () => {
    const db = dbFor(WHO)
    for (const id of [`${AWARD}_1`, `award_${AWARD}_extra`, `award_${AWARD}_1_copy`, `copy_of_${AWARD}`, 'copy_1', `priority_${AWARD}_1`]) {
      await expectDenied(editAward(db, WHO, { extraEntries: [[id, twin()]] }), `a second entry as ${id}`)
    }
    await expectAllowed(editAward(db, WHO), 'the change with its one entry')
  })

  test('[V12] an entry with another target type is refused even when its id is built from that type', async () => {
    const db = dbFor(WHO)
    await expectDenied(editPriority(db, WHO, { audit: { targetType: 'raid' }, entryKey: `raid_${PRIORITY_ID}_1` }), 'targetType raid')
    await expectDenied(editPriority(db, WHO, { audit: { targetType: 'Priority' }, entryKey: `Priority_${PRIORITY_ID}_1` }), 'targetType Priority')
    await expectAllowed(editPriority(db, WHO), 'the honest entry')
  })

  test('[V25,V26] a revision below 1 is refused, even for an award or priority that already holds one', async () => {
    await asAdmin(async (db) => {
      await setDoc(guildDoc(db, 'awards/award-neg'), awardDoc({ rev: -1 }))
      await setDoc(guildDoc(db, 'lootPriorities/priority-neg'), priorityDoc({ rev: -1 }))
    })
    const db = dbFor(WHO)
    await expectDenied(editAward(db, WHO, { awardId: 'award-neg', rev: 0 }), 'an award going from -1 to 0')
    await expectDenied(editPriority(db, WHO, { id: 'priority-neg', rev: 0 }), 'a priority going from -1 to 0')
  })

  test('[V18] ids may contain underscores', async () => {
    await asAdmin(async (db) => {
      await setDoc(guildDoc(db, 'awards/award_2'), awardDoc())
      await setDoc(guildDoc(db, 'lootPriorities/priority_2'), priorityDoc())
    })
    const db = dbFor(WHO)
    await expectAllowed(editAward(db, WHO, { awardId: 'award_2' }), 'an award with an underscore in its id')
    await expectAllowed(editPriority(db, WHO, { id: 'priority_2' }), 'a priority with an underscore in its id')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('the list of changed fields', () => {
  test('[D15] a duplicate in the list cannot stand in for a field that changed but is not listed', async () => {
    const changes = { recipient: PLAYER_3, awardNote: 'Swapped gear' }
    const honest = describeChange(awardDoc(), changes)
    await expectDenied(editAward(dbFor(WHO), WHO, { changes, audit: { changed: ['recipient', 'recipient'], before: { recipient: PLAYER_2 }, after: { recipient: PLAYER_3 } } }), 'recipient twice, awardNote not at all')
    await expectAllowed(editAward(dbFor(WHO), WHO, { changes, audit: honest }), 'the honest list')
  })
})

describe('a delete entry is only for a priority that is really gone', () => {
  test('[V81] an honest delete entry is refused while the priority is still there, on its own or next to an edit', async () => {
    const db = dbFor(WHO)
    const current = priorityDoc()
    const deleteEntry = entry(WHO, 'priority', PRIORITY_ID, 1, { action: 'delete', item: current.item, changed: Object.keys(current), before: current })
    await expectDenied(setDoc(guildDoc(db, `auditLog/${entryId('priority', PRIORITY_ID, 1)}`), deleteEntry), 'a delete entry on its own')
    const batch = writeBatch(db)
    batch.update(guildDoc(db, `lootPriorities/${PRIORITY_ID}`), { councilNote: 'Rewritten note', rev: 1 })
    batch.set(guildDoc(db, `auditLog/${entryId('priority', PRIORITY_ID, 1)}`), deleteEntry)
    await expectDenied(batch.commit(), 'a delete entry next to an edit of the same priority')
    assert.ok(await stored(`lootPriorities/${PRIORITY_ID}`))
    assert.equal(await stored(`auditLog/${entryId('priority', PRIORITY_ID, 1)}`), undefined)
    await expectAllowed(deletePriority(db, WHO), 'the real delete with its entry')
  })
})

describe('the item label is limited to 120 characters of text', () => {
  // KNOWN LIMIT, pinned on purpose: creating awards and writing priorities are not size-checked yet, so a stored item can be longer than 120
  // characters or not text at all. The entry label has to equal the stored item, so such an award or priority cannot be corrected or
  // reordered with an entry. Raise the cap on both sides if that should change.
  test('[V42,V43,V44] an award or priority whose stored item is longer than 120 characters, or not text, cannot be edited with an entry', async () => {
    await asAdmin(async (db) => {
      await setDoc(guildDoc(db, 'awards/award-long'), awardDoc({ item: 'x'.repeat(121) }))
      await setDoc(guildDoc(db, 'lootPriorities/priority-long'), priorityDoc({ item: 'x'.repeat(121) }))
      await setDoc(guildDoc(db, 'lootPriorities/priority-list'), priorityDoc({ item: ['Test Sword'] }))
      await setDoc(guildDoc(db, 'lootPriorities/priority-120'), priorityDoc({ item: 'x'.repeat(120) }))
    })
    const db = dbFor(WHO)
    await expectDenied(editAward(db, WHO, { awardId: 'award-long' }), 'an award with a 121-character item')
    await expectDenied(editPriority(db, WHO, { id: 'priority-long' }), 'a priority with a 121-character item')
    await expectDenied(editPriority(db, WHO, { id: 'priority-list' }), 'a priority whose item is a list')
    await expectAllowed(editPriority(db, WHO, { id: 'priority-120' }), 'a priority with a 120-character item')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The SDK writes whole numbers as integers, so a double with a whole value needs a hand-built request (support/raw.ts).
describe('an entry revision that is a whole-number double', () => {
  const P = priorityDoc()
  const nulls = Object.fromEntries(Object.keys(P).map((key) => [key, null]))
  const staff = UID.raidLeader
  const entryFields = (extra: Record<string, unknown>) => ({ at: requestTime, by: staff, byName: displayNameOf(staff), targetType: 'priority', item: 'Test Sword', ...extra })

  test('[V24,V27] a priority create entry for revision 1.0 is refused, so no entry id like priority_x_1.0 can exist', async () => {
    const create = (entryRev: unknown, id: string) => rawCommit(staff, [
      { path: 'lootPriorities/priority-2', fields: { ...P, rev: 1, updatedBy: staff, updatedAt: requestTime } },
      { path: `auditLog/${id}`, fields: entryFields({ targetId: 'priority-2', rev: entryRev, action: 'create', changed: Object.keys(P), before: nulls, after: P }) },
    ])
    assert.equal(await create(asDouble(1), 'priority_priority-2_1.0'), 'denied', 'revision 1.0 under the id with .0')
    assert.equal(await create(asDouble(1), 'priority_priority-2_1'), 'denied', 'revision 1.0 under the plain id')
    assert.equal(await create(1, 'priority_priority-2_1'), 'allowed', 'revision 1 (control: the same request with an integer)')
  })

  test('[V24,V27] a priority edit entry for revision 1.0 is refused', async () => {
    const edit = (entryRev: unknown, id: string) => rawCommit(staff, [
      { path: `lootPriorities/${PRIORITY_ID}`, mask: ['councilNote', 'rev'], fields: { councilNote: 'Rewritten note', rev: 1 } },
      { path: `auditLog/${id}`, fields: entryFields({ targetId: PRIORITY_ID, rev: entryRev, action: 'edit', changed: ['councilNote'], before: { councilNote: P.councilNote }, after: { councilNote: 'Rewritten note' } }) },
    ])
    assert.equal(await edit(asDouble(1), `priority_${PRIORITY_ID}_1.0`), 'denied', 'revision 1.0 under the id with .0')
    assert.equal(await edit(1, `priority_${PRIORITY_ID}_1`), 'allowed', 'revision 1 (control)')
  })
})
