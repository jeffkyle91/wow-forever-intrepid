// The link between an account (members/{uid}.playerId) and a roster character (roster/{id}.linkedUid).
// The rules keep the two sides in agreement: each side is checked against the other as it will be after
// the write (getAfter), and a previous link must be released in the same batch. So every change to a link
// is a batch that touches both documents, which is what updateMembershipAccess and approveJoinRequest send.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, deleteField, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { addMember } from './support/arrange.ts'
import { updateMembershipAccessBatch } from './support/client.ts'
import { BYSTANDER, LABEL, NEWCOMER, PLAYER_1, PLAYER_2, UID, memberDoc, rosterDoc } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, stored, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()

// match /members/{userId} (create, update) and match /roster/{playerId} (create, update)
// Only a Guild Leader writes either, and a link has to agree from both sides at the end of the batch.
describe('linking an account to a character', () => {
  test('writing both sides in one batch links them', async () => {
    await expectAllowed(updateMembershipAccessBatch(dbFor('guildLeader'), UID.member, 'Member', null, PLAYER_1).commit())
    assert.equal((await stored(`members/${UID.member}`))?.playerId, PLAYER_1)
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, UID.member)
  })

  test('writing only the members doc is refused', async () => {
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { role: 'Member', playerId: PLAYER_1 }))
  })

  test('writing only the roster doc is refused', async () => {
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`), { linkedUid: UID.member }))
  })

  test('a roster character cannot be linked to a uid that has no members doc', async () => {
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`), { linkedUid: 'uid-ghost' }))
  })

  test('a members doc cannot point at a character that does not exist', async () => {
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { role: 'Member', playerId: 'player-404' }))
  })

  // A number in a path becomes its text, so playerId 42 would find the character "42". With one in place
  // that already links back to the member (a one-sided leftover link, say from a console edit), the
  // `is string` test in the rules is the only thing that can refuse it. Without that document the number is
  // refused anyway, because the document it points at does not exist.
  test('a playerId that is a number is refused even when a character with that id links back', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'roster/42'), rosterDoc(42, { linkedUid: UID.member })))
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { role: 'Member', playerId: 42 }))
  })

  // The same from the other side: the members doc "42" exists and points at the character.
  test('a linkedUid that is a number is refused even when a members doc has that id', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'members/42'), memberDoc('42', 'Member', PLAYER_1)))
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`), { linkedUid: 42 }))
  })

  // Each side is checked against the other as it will be after the write, so a write that touches one
  // document has to find the other side already agreeing. These two find it linked to somebody else.
  test('a members doc cannot claim a character that is linked to someone else', async () => {
    await addMember(BYSTANDER, 'Member', PLAYER_1)
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { role: 'Member', playerId: PLAYER_1 }))
  })

  test('a roster character cannot be linked to a member who is linked to a different character', async () => {
    await addMember(BYSTANDER, 'Member', PLAYER_1)
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_2}`), { linkedUid: BYSTANDER }))
  })

  for (const who of ['raidLeader', 'member'] as const) {
    test(`a ${LABEL[who]} cannot link anyone to a character`, async () => {
      await expectDenied(updateMembershipAccessBatch(dbFor(who), UID.member, 'Member', null, PLAYER_1).commit())
    })
  }

  test('a character that belongs to someone else cannot simply be claimed', async () => {
    await addMember(BYSTANDER, 'Member', PLAYER_1)
    const db = dbFor('guildLeader')
    const batch = writeBatch(db)
    batch.update(guildDoc(db, `roster/${PLAYER_1}`), { linkedUid: UID.member })
    batch.update(guildDoc(db, `members/${UID.member}`), { role: 'Member', playerId: PLAYER_1 })
    await expectDenied(batch.commit())
  })

  test('it can be taken over when the previous owner is released in the same batch', async () => {
    await addMember(BYSTANDER, 'Member', PLAYER_1)
    const db = dbFor('guildLeader')
    const batch = writeBatch(db)
    batch.update(guildDoc(db, `roster/${PLAYER_1}`), { linkedUid: UID.member })
    batch.update(guildDoc(db, `members/${UID.member}`), { role: 'Member', playerId: PLAYER_1 })
    batch.update(guildDoc(db, `members/${BYSTANDER}`), { role: 'Member', playerId: null })
    await expectAllowed(batch.commit())
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, UID.member)
  })

  test('a new character cannot be created already linked to an account that does not point back at it', async () => {
    await expectDenied(setDoc(guildDoc(dbFor('guildLeader'), 'roster/player-9'), rosterDoc(9, { linkedUid: UID.member })))
  })

  test('a new members doc cannot point at a character that is not linked back to it', async () => {
    await expectDenied(setDoc(guildDoc(dbFor('guildLeader'), `members/${NEWCOMER}`), memberDoc(NEWCOMER, 'Member', PLAYER_1)))
  })

  test('a new character can be created already linked when the account is updated in the same batch', async () => {
    const db = dbFor('guildLeader')
    const batch = writeBatch(db)
    batch.set(guildDoc(db, 'roster/player-9'), rosterDoc(9, { linkedUid: UID.member }))
    batch.update(guildDoc(db, `members/${UID.member}`), { role: 'Member', playerId: 'player-9' })
    await expectAllowed(batch.commit())
  })

  test('moving a member to another character releases the first one', async () => {
    await addMember(UID.member, 'Member', PLAYER_1)
    await expectAllowed(updateMembershipAccessBatch(dbFor('guildLeader'), UID.member, 'Member', PLAYER_1, PLAYER_2).commit())
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, undefined)
    assert.equal((await stored(`roster/${PLAYER_2}`))?.linkedUid, UID.member)
  })

  test('moving a member to another character without releasing the first is refused', async () => {
    await addMember(UID.member, 'Member', PLAYER_1)
    const db = dbFor('guildLeader')
    const batch = writeBatch(db)
    batch.update(guildDoc(db, `roster/${PLAYER_2}`), { linkedUid: UID.member })
    batch.update(guildDoc(db, `members/${UID.member}`), { role: 'Member', playerId: PLAYER_2 })
    await expectDenied(batch.commit())
  })

  test('unlinking clears both sides in one batch', async () => {
    await addMember(UID.member, 'Member', PLAYER_1)
    await expectAllowed(updateMembershipAccessBatch(dbFor('guildLeader'), UID.member, 'Member', PLAYER_1, null).commit())
    assert.equal((await stored(`members/${UID.member}`))?.playerId, null)
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, undefined)
  })

  test('unlinking only the members side is refused', async () => {
    await addMember(UID.member, 'Member', PLAYER_1)
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { role: 'Member', playerId: null }))
  })

  test('unlinking only the roster side is refused', async () => {
    await addMember(UID.member, 'Member', PLAYER_1)
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`), { linkedUid: deleteField() }))
  })

  // Everyday edits to documents that are already linked. A write that leaves the link as it was must not be
  // treated as releasing it: PlayerModal saves a character with a merge write (saveGuildRecord), and the
  // Access screen changes a role through updateMembershipAccess, which sends the same playerId back. Both
  // pass through the "link unchanged" shortcuts in the rules.
  test('renaming a linked character keeps the link', async () => {
    await addMember(UID.member, 'Member', PLAYER_1)
    await expectAllowed(setDoc(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`), rosterDoc(1, { name: 'Renamed Character' }), { merge: true }))
    assert.equal((await stored(`roster/${PLAYER_1}`))?.name, 'Renamed Character')
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, UID.member)
  })

  test("changing a linked member's role keeps the link", async () => {
    await addMember(UID.member, 'Member', PLAYER_1)
    await expectAllowed(updateMembershipAccessBatch(dbFor('guildLeader'), UID.member, 'Raid Leader', PLAYER_1, PLAYER_1).commit())
    assert.equal((await stored(`members/${UID.member}`))?.role, 'Raid Leader')
    assert.equal((await stored(`members/${UID.member}`))?.playerId, PLAYER_1)
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, UID.member)
  })

  // README "Firebase project setup" step 5: the first Guild Leader's members doc is made by hand with only
  // email, displayName and role. It has no playerId field at all, and must still work.
  test('a hand-made Guild Leader doc with no playerId field can add characters and link itself', async () => {
    await asAdmin((db) =>
      setDoc(guildDoc(db, `members/${UID.guildLeader}`), { email: 'hand-made@example.test', displayName: 'Hand Made', role: 'Guild Leader' }),
    )
    const db = dbFor('guildLeader')
    await expectAllowed(setDoc(guildDoc(db, 'roster/player-9'), rosterDoc(9), { merge: true }), 'adding a character')
    await expectAllowed(updateMembershipAccessBatch(db, UID.guildLeader, 'Guild Leader', null, PLAYER_1).commit(), 'linking itself')
  })
})

// match /roster/{playerId}: delete
// A Guild Leader can delete a character only while no account is linked to it.
describe('deleting a roster character', () => {
  test('a linked character cannot be deleted', async () => {
    await addMember(UID.member, 'Member', PLAYER_1)
    await expectDenied(deleteDoc(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`)))
  })

  test('unlinking and deleting in one batch is refused; two steps work', async () => {
    await addMember(UID.member, 'Member', PLAYER_1)
    const db = dbFor('guildLeader')
    const together = writeBatch(db)
    together.update(guildDoc(db, `members/${UID.member}`), { role: 'Member', playerId: null })
    together.delete(guildDoc(db, `roster/${PLAYER_1}`))
    await expectDenied(together.commit(), 'unlink and delete together')

    await expectAllowed(updateMembershipAccessBatch(db, UID.member, 'Member', PLAYER_1, null).commit(), 'unlinking first')
    await expectAllowed(deleteDoc(guildDoc(db, `roster/${PLAYER_1}`)), 'deleting afterwards')
  })

  test('a leftover link that the member side no longer confirms does not block the delete', async () => {
    await asAdmin((db) => updateDoc(guildDoc(db, `roster/${PLAYER_1}`), { linkedUid: UID.member })) // the member's playerId is still null
    await expectAllowed(deleteDoc(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`)))
  })
})
