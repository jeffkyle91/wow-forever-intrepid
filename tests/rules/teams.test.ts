// Raid team assignments: the teamAssignments block of firestore.rules. Who may write is in access-matrix.test.ts;
// this file is about what they may write.
//
// Tests labeled "KNOWN GAP" pin what the rules do today even though it is arguably wrong or weak. When a
// rules change closes a gap, the matching test fails: flip it to expect a denial and drop the label.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, setDoc } from 'firebase/firestore'
import { PLAYER_2 } from './support/fixtures.ts'
import { dbFor, expectAllowed, expectDenied, guildDoc, setUpGuildEmulator, stored } from './support/harness.ts'

setUpGuildEmulator()

// match /teamAssignments/{playerId}: create and update
// Guild and Raid Leaders write an assignment, and it holds exactly one field, `team`, which is one of the four colors.
describe('assigning a character to a team', () => {
  const assign = (data: Record<string, unknown>, id = PLAYER_2) => setDoc(guildDoc(dbFor('raidLeader'), `teamAssignments/${id}`), data)

  for (const team of ['blue', 'yellow', 'red', 'white']) {
    test(`the ${team} team is accepted`, async () => {
      await expectAllowed(assign({ team }))
      assert.equal((await stored(`teamAssignments/${PLAYER_2}`))?.team, team)
    })
  }

  const refused: [string, Record<string, unknown>][] = [
    ['a color that is not one of the four', { team: 'green' }],
    ['a team that is not a string', { team: 1 }],
    ['no team', {}],
    ['an extra field', { team: 'blue', note: 'tank' }],
  ]
  for (const [what, payload] of refused) {
    test(`an assignment with ${what} is refused`, async () => {
      await expectDenied(assign(payload))
    })
  }

  // KNOWN GAP: the rules do not check that the id belongs to a roster character, so an assignment can
  // exist for an id that is not in the roster. Removing an assignment that does not exist also succeeds.
  test('KNOWN GAP: an assignment for an id that is not in the roster is accepted', async () => {
    await expectAllowed(assign({ team: 'red' }, 'player-404'))
  })

  test('KNOWN GAP: deleting an assignment that does not exist is accepted', async () => {
    await expectAllowed(deleteDoc(guildDoc(dbFor('raidLeader'), `teamAssignments/${PLAYER_2}`)))
  })
})
