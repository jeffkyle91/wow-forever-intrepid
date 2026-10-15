// Getting into the guild and holding a role: the joinRequests and members blocks of firestore.rules.
//
// Tests labelled "KNOWN GAP" pin what the rules do today even though it is arguably wrong or weak. They
// are not endorsements. When a rules change closes a gap, the matching test fails: flip it to expect a
// denial, and drop the label.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { Timestamp, deleteField, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { guildRoles, type GuildRole } from '../../src/security.ts'
import { addJoinRequest, addMember } from './support/arrange.ts'
import { approveJoinRequestBatch } from './support/client.ts'
import {
  APPLICANT,
  BYSTANDER,
  GUILD_ID,
  LABEL,
  NEWCOMER,
  PLAYER_1,
  PLAYER_2,
  UID,
  joinRequestDoc,
  memberDoc,
  requestOf,
  without,
} from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, stored, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()

// match /joinRequests/{userId}: creating a request
// A signed-in user can create their own request, and only in the exact shape submitJoinRequest sends:
// status pending, no role fields. (They cannot give themselves a role; see "self-promotion" below.)
describe('filing a join request', () => {
  test('a stranger can file a request for themselves', async () => {
    await expectAllowed(setDoc(guildDoc(dbFor('stranger'), `joinRequests/${UID.stranger}`), joinRequestDoc(UID.stranger)))
    assert.equal((await stored(`joinRequests/${UID.stranger}`))?.status, 'pending')
  })

  const refused: [string, Record<string, unknown>][] = [
    ['names someone else in userId', { userId: 'uid-victim' }],
    ['is already approved', { status: 'approved' }],
    ['is already rejected', { status: 'rejected' }],
    ['carries a role', { role: 'Guild Leader' }],
    ['carries an assignedRole', { assignedRole: 'Guild Leader' }],
    ['carries a linkedPlayerId', { linkedPlayerId: PLAYER_1 }],
  ]
  for (const [what, overrides] of refused) {
    test(`a request that ${what} is refused`, async () => {
      await expectDenied(setDoc(guildDoc(dbFor('stranger'), `joinRequests/${UID.stranger}`), joinRequestDoc(UID.stranger, overrides)))
    })
  }

  test("a request filed at someone else's path is refused even when it names the caller inside", async () => {
    await expectDenied(setDoc(guildDoc(dbFor('stranger'), `joinRequests/${NEWCOMER}`), joinRequestDoc(UID.stranger)))
  })

  // KNOWN GAP: the create rule only restricts which keys may appear (hasOnly allows a subset) and what
  // the status is. It does not require email or displayName, check their types or sizes, or make
  // requestedAt the server time, so a request can arrive missing fields the Access screen reads.
  const shallow: [string, Record<string, unknown>][] = [
    ['has no email and no displayName', without(joinRequestDoc(UID.stranger), 'email', 'displayName')],
    ['has a displayName that is a number', joinRequestDoc(UID.stranger, { displayName: 42 })],
    ['has a 200 KB displayName', joinRequestDoc(UID.stranger, { displayName: 'x'.repeat(200_000) })],
    ['has a requestedAt chosen by the client', joinRequestDoc(UID.stranger, { requestedAt: Timestamp.fromDate(new Date('2001-01-01T00:00:00Z')) })],
  ]
  for (const [what, payload] of shallow) {
    test(`KNOWN GAP: a request that ${what} is accepted`, async () => {
      await expectAllowed(setDoc(guildDoc(dbFor('stranger'), `joinRequests/${UID.stranger}`), payload))
    })
  }
})

// match /joinRequests/{userId}: resubmitting
// The owner can overwrite their own request only after a leader rejected it, and only back to pending.
// While it is pending or after it was approved they cannot touch it.
describe('resubmitting a join request', () => {
  const mine = () => guildDoc(dbFor('stranger'), `joinRequests/${UID.stranger}`)

  test('filing again while the first request is pending is refused', async () => {
    await addJoinRequest(UID.stranger)
    await expectDenied(setDoc(mine(), joinRequestDoc(UID.stranger)))
  })

  test('the owner cannot edit their own pending request', async () => {
    await addJoinRequest(UID.stranger)
    await expectDenied(updateDoc(mine(), { displayName: 'Changed' }))
  })

  test('after a rejection the owner can resubmit, and the request goes back to pending', async () => {
    await addJoinRequest(UID.stranger, { status: 'rejected' })
    await expectAllowed(setDoc(mine(), joinRequestDoc(UID.stranger)))
    assert.equal((await stored(`joinRequests/${UID.stranger}`))?.status, 'pending')
  })

  test('after a rejection the owner cannot slip a role into the resubmitted request', async () => {
    await addJoinRequest(UID.stranger, { status: 'rejected' })
    await expectDenied(setDoc(mine(), joinRequestDoc(UID.stranger, { assignedRole: 'Guild Leader' })))
  })

  test('after a rejection the owner still cannot jump straight to approved', async () => {
    await addJoinRequest(UID.stranger, { status: 'rejected' })
    await expectDenied(setDoc(mine(), joinRequestDoc(UID.stranger, { status: 'approved' })))
  })

  test('after an approval the owner cannot file again', async () => {
    await addJoinRequest(UID.stranger, { status: 'approved', assignedRole: 'Member', linkedPlayerId: null })
    await expectDenied(setDoc(mine(), joinRequestDoc(UID.stranger)))
  })

  // Whose request it is matters twice over in this branch. The path has to be the caller's, or anyone signed
  // in could replace another person's rejected request with their own. And userId inside the document has
  // to be the caller's too: approving reads it from the request's data (src/guildApi.ts, approveJoinRequest)
  // to decide whose members doc to write, so a request that names someone else would aim the approval at them.
  test("after a rejection a stranger cannot overwrite someone else's request with their own", async () => {
    await addJoinRequest(APPLICANT, { status: 'rejected' })
    await expectDenied(setDoc(guildDoc(dbFor('stranger'), `joinRequests/${APPLICANT}`), joinRequestDoc(UID.stranger)))
  })

  test('after a rejection the owner cannot resubmit with someone else in userId', async () => {
    await addJoinRequest(UID.stranger, { status: 'rejected' })
    await expectDenied(setDoc(mine(), joinRequestDoc(UID.stranger, { userId: BYSTANDER })))
  })
})

// match /joinRequests/{userId} and /members/{userId}: answering a request
// Only a Guild Leader answers. Rejecting is a single update. Approving is one batch that creates the
// members doc, optionally links a roster character, and marks the request approved; the rules read the
// members doc as it will be after the batch (getAfter) and require the request to agree with it.
describe('answering a join request', () => {
  test('a Guild Leader cannot put a request back to pending', async () => {
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `joinRequests/${APPLICANT}`), { status: 'pending' }))
  })

  test('a Guild Leader cannot add other fields to a request while answering it', async () => {
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `joinRequests/${APPLICANT}`), { status: 'rejected', note: 'no thanks' }))
  })

  test('a Guild Leader can reject a pending request', async () => {
    await expectAllowed(updateDoc(guildDoc(dbFor('guildLeader'), `joinRequests/${APPLICANT}`), { status: 'rejected' }))
    assert.equal((await stored(`joinRequests/${APPLICANT}`))?.status, 'rejected')
  })

  for (const role of guildRoles) {
    test(`a Guild Leader can approve a request as ${role}`, async () => {
      await expectAllowed(approveJoinRequestBatch(dbFor('guildLeader'), requestOf(APPLICANT), role).commit())
      assert.equal((await stored(`members/${APPLICANT}`))?.role, role)
      assert.equal((await stored(`joinRequests/${APPLICANT}`))?.status, 'approved')
    })
  }

  test('approving can link the new member to a roster character in the same batch', async () => {
    await expectAllowed(approveJoinRequestBatch(dbFor('guildLeader'), requestOf(APPLICANT), 'Member', PLAYER_1).commit())
    assert.equal((await stored(`members/${APPLICANT}`))?.playerId, PLAYER_1)
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, APPLICANT)
  })

  test('approving cannot claim a character another member is already linked to', async () => {
    await addMember(BYSTANDER, 'Member', PLAYER_1)
    await expectDenied(approveJoinRequestBatch(dbFor('guildLeader'), requestOf(APPLICANT), 'Member', PLAYER_1).commit())
  })

  for (const who of ['raidLeader', 'member', 'stranger'] as const) {
    test(`a ${LABEL[who]} cannot approve a request`, async () => {
      await expectDenied(approveJoinRequestBatch(dbFor(who), requestOf(APPLICANT), 'Member').commit())
    })
    test(`a ${LABEL[who]} cannot reject a request`, async () => {
      await expectDenied(updateDoc(guildDoc(dbFor(who), `joinRequests/${APPLICANT}`), { status: 'rejected' }))
    })
  }

  test('a role the app does not define is refused', async () => {
    await expectDenied(approveJoinRequestBatch(dbFor('guildLeader'), requestOf(APPLICANT), 'Admin' as GuildRole).commit())
  })

  test('the request must record the same role the members doc gets', async () => {
    const db = dbFor('guildLeader')
    const batch = writeBatch(db)
    batch.set(guildDoc(db, `members/${APPLICANT}`), memberDoc(APPLICANT, 'Member'))
    batch.update(guildDoc(db, `joinRequests/${APPLICANT}`), { status: 'approved', assignedRole: 'Guild Leader', linkedPlayerId: null })
    await expectDenied(batch.commit())
  })

  // The request has to record the same character the members doc ends up linked to, in both directions.
  const approveRecording = (memberPlayerId: string | null, requestPlayerId: string | null) => {
    const db = dbFor('guildLeader')
    const batch = writeBatch(db)
    batch.set(guildDoc(db, `members/${APPLICANT}`), memberDoc(APPLICANT, 'Member', memberPlayerId))
    if (memberPlayerId) batch.update(guildDoc(db, `roster/${memberPlayerId}`), { linkedUid: APPLICANT })
    batch.update(guildDoc(db, `joinRequests/${APPLICANT}`), { status: 'approved', assignedRole: 'Member', linkedPlayerId: requestPlayerId })
    return batch.commit()
  }

  test('a request that records the character the members doc is linked to is accepted', async () => {
    await expectAllowed(approveRecording(PLAYER_1, PLAYER_1))
  })

  test('a request that records a character the members doc does not carry is refused', async () => {
    await expectDenied(approveRecording(null, PLAYER_1))
  })

  test('a request that records no character while the members doc carries one is refused', async () => {
    await expectDenied(approveRecording(PLAYER_1, null))
  })

  test('a request cannot be marked approved without creating the member', async () => {
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `joinRequests/${APPLICANT}`), { status: 'approved', assignedRole: 'Member', linkedPlayerId: null }))
  })

  // KNOWN GAP: approving is a plain set() of the members doc with no check that the person is not already
  // a member, so approving a stale or stray request overwrites their members doc. A Guild Leader or Raid
  // Leader who files a request (allowed, see the matrix) and has it approved is demoted to the approved
  // role. If the overwritten member is the only Guild Leader, the guild is left with none.
  for (const existing of ['Guild Leader', 'Raid Leader'] as const) {
    test(`KNOWN GAP: approving a request from an existing ${existing} as Member overwrites their role`, async () => {
      await addMember(NEWCOMER, existing)
      await addJoinRequest(NEWCOMER)
      await expectAllowed(approveJoinRequestBatch(dbFor('guildLeader'), requestOf(NEWCOMER), 'Member').commit())
      assert.equal((await stored(`members/${NEWCOMER}`))?.role, 'Member')
    })
  }

  test('the overwrite is refused when the existing member is linked to a character and the approval would drop the link', async () => {
    await addMember(NEWCOMER, 'Raid Leader', PLAYER_1)
    await addJoinRequest(NEWCOMER)
    await expectDenied(approveJoinRequestBatch(dbFor('guildLeader'), requestOf(NEWCOMER), 'Member', null).commit())
    await expectDenied(approveJoinRequestBatch(dbFor('guildLeader'), requestOf(NEWCOMER), 'Member', PLAYER_2).commit())
  })

  test('KNOWN GAP: approving over an existing linked member goes through when the approval keeps the same link', async () => {
    await addMember(NEWCOMER, 'Raid Leader', PLAYER_1)
    await addJoinRequest(NEWCOMER)
    await expectAllowed(approveJoinRequestBatch(dbFor('guildLeader'), requestOf(NEWCOMER), 'Member', PLAYER_1).commit())
    assert.equal((await stored(`members/${NEWCOMER}`))?.role, 'Member')
  })

  // KNOWN GAP: a request has no state machine. A leader can approve one that was already rejected, and
  // reject one that was already approved (the members doc is left in place).
  test('KNOWN GAP: a rejected request can later be approved', async () => {
    await addJoinRequest(APPLICANT, { status: 'rejected' })
    await expectAllowed(approveJoinRequestBatch(dbFor('guildLeader'), requestOf(APPLICANT), 'Member').commit())
  })

  test('KNOWN GAP: an approved request can later be rejected, and the member stays', async () => {
    await addMember(APPLICANT, 'Member')
    await addJoinRequest(APPLICANT, { status: 'approved', assignedRole: 'Member', linkedPlayerId: null })
    await expectAllowed(updateDoc(guildDoc(dbFor('guildLeader'), `joinRequests/${APPLICANT}`), { status: 'rejected' }))
    assert.equal((await stored(`members/${APPLICANT}`))?.role, 'Member')
  })

  // KNOWN GAP: answering a request checks the status and the set of keys, not the other fields, so the
  // same update that rejects a request can also change who it says it is from. The app never does this
  // (it sends only the status), and only a Guild Leader can; but approveJoinRequest in src/guildApi.ts reads
  // userId from the request's data, so the request is only as trustworthy as the leader's client.
  test('KNOWN GAP: a Guild Leader can rewrite userId, email and displayName while answering a request', async () => {
    await expectAllowed(
      updateDoc(guildDoc(dbFor('guildLeader'), `joinRequests/${APPLICANT}`), {
        status: 'rejected',
        userId: 'uid-someone-else',
        email: 'someone-else@example.test',
        displayName: 'Someone Else',
      }),
    )
    assert.equal((await stored(`joinRequests/${APPLICANT}`))?.userId, 'uid-someone-else')
  })
})

// match /members/{userId}: roles
// Only a Guild Leader writes members docs, and only with one of the three roles. Nobody can reach a
// higher role by writing their own doc, filing a request, or approving themselves.
describe('self-promotion', () => {
  const attempts: [who: 'member' | 'raidLeader', what: string, change: Record<string, unknown>][] = [
    ['member', 'raise their own role to Guild Leader', { role: 'Guild Leader' }],
    ['member', 'raise their own role to Raid Leader', { role: 'Raid Leader' }],
    ['member', 'link themselves to a roster character', { playerId: PLAYER_1 }],
    ['member', 'rename themselves', { displayName: 'Changed' }],
    ['raidLeader', 'raise their own role to Guild Leader', { role: 'Guild Leader' }],
  ]
  for (const [who, what, change] of attempts) {
    test(`a ${LABEL[who]} cannot ${what}`, async () => {
      await expectDenied(updateDoc(guildDoc(dbFor(who), `members/${UID[who]}`), change))
    })
  }

  test('a Raid Leader cannot promote someone else', async () => {
    await expectDenied(updateDoc(guildDoc(dbFor('raidLeader'), `members/${BYSTANDER}`), { role: 'Guild Leader' }))
  })

  for (const role of guildRoles) {
    test(`a stranger cannot create their own members doc as ${role}`, async () => {
      await expectDenied(setDoc(guildDoc(dbFor('stranger'), `members/${UID.stranger}`), memberDoc(UID.stranger, role)))
    })
  }

  test('an owner cannot approve their own request, alone or together with their own members doc', async () => {
    await addJoinRequest(UID.stranger)
    const db = dbFor('stranger')
    await expectDenied(updateDoc(guildDoc(db, `joinRequests/${UID.stranger}`), { status: 'approved', assignedRole: 'Guild Leader', linkedPlayerId: null }))
    await expectDenied(approveJoinRequestBatch(db, requestOf(UID.stranger), 'Guild Leader').commit())
  })

  test('control: a Guild Leader can promote a Member', async () => {
    await expectAllowed(updateDoc(guildDoc(dbFor('guildLeader'), `members/${BYSTANDER}`), { role: 'Guild Leader' }))
  })

  for (const role of guildRoles) {
    test(`a Guild Leader can give the ${role} role`, async () => {
      await expectAllowed(setDoc(guildDoc(dbFor('guildLeader'), `members/${NEWCOMER}`), memberDoc(NEWCOMER, role)))
    })
  }

  const badRoles: [string, unknown][] = [
    ['the role "Admin"', 'Admin'],
    ['a role in the wrong case ("guild leader")', 'guild leader'],
    ['an empty role', ''],
    ['a number as the role', 42],
  ]
  // Both ways a role gets written: a new members doc (create), and a change to an existing one (update).
  // A role the rules do not know would lock that person out, because every other rule reads the role.
  for (const [what, role] of badRoles) {
    test(`a Guild Leader cannot give ${what}`, async () => {
      await expectDenied(setDoc(guildDoc(dbFor('guildLeader'), `members/${NEWCOMER}`), memberDoc(NEWCOMER, 'Member', null, { role })))
    })
    test(`a Guild Leader cannot change an existing member's role to ${what}`, async () => {
      await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${BYSTANDER}`), { role }))
    })
  }

  test('a Guild Leader cannot create a members doc with no role', async () => {
    await expectDenied(setDoc(guildDoc(dbFor('guildLeader'), `members/${NEWCOMER}`), without(memberDoc(NEWCOMER, 'Member'), 'role')))
  })

  test("a Guild Leader cannot remove an existing member's role", async () => {
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${BYSTANDER}`), { role: deleteField() }))
  })

  // KNOWN GAP (minor): members docs have no key whitelist or field checks, so a leader can store any field.
  test('KNOWN GAP: a Guild Leader can store an arbitrary extra field on a members doc', async () => {
    await expectAllowed(updateDoc(guildDoc(dbFor('guildLeader'), `members/${BYSTANDER}`), { isAdmin: true }))
  })
})

// match /members/{userId}: the last Guild Leader
// The rules do not stop a Guild Leader from changing their own role, so the only guard against leaving the
// guild with no leader is in the interface. Once there is none, no client can create one: a members doc
// for a Guild Leader has to be written in the Firebase console (see "Firebase project setup" in the README).
describe('the last Guild Leader', () => {
  for (const newRole of ['Raid Leader', 'Member'] as const) {
    test(`KNOWN GAP: the only Guild Leader can demote themselves to ${newRole}`, async () => {
      await expectAllowed(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.guildLeader}`), { role: newRole }))
      assert.equal((await stored(`members/${UID.guildLeader}`))?.role, newRole)
    })
  }

  test('with no Guild Leader left, nobody can restore one from the client', async () => {
    await asAdmin((db) => updateDoc(guildDoc(db, `members/${UID.guildLeader}`), { role: 'Member' }))

    // the former leader puts themselves back
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.guildLeader}`), { role: 'Guild Leader' }))
    // a Raid Leader promotes them, or a new member
    await expectDenied(updateDoc(guildDoc(dbFor('raidLeader'), `members/${UID.guildLeader}`), { role: 'Guild Leader' }))
    await expectDenied(setDoc(guildDoc(dbFor('raidLeader'), `members/${NEWCOMER}`), memberDoc(NEWCOMER, 'Guild Leader')))
    // anyone creates their own leader doc
    await expectDenied(setDoc(guildDoc(dbFor('stranger'), `members/${UID.stranger}`), memberDoc(UID.stranger, 'Guild Leader')))
    // the guild document itself cannot be edited from the client either
    await expectDenied(setDoc(doc(dbFor('raidLeader'), `guilds/${GUILD_ID}`), { name: 'Rescued' }))
  })

  test('control: with two Guild Leaders, one can demote the other', async () => {
    await addMember(NEWCOMER, 'Guild Leader')
    await expectAllowed(updateDoc(guildDoc(dbFor('guildLeader'), `members/${NEWCOMER}`), { role: 'Member' }))
  })
})
