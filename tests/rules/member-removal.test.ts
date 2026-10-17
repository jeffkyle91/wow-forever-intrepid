import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, getDocFromServer, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { setMembershipRemoved } from '../../src/shared/members/access.ts'
import { GUILD_ID, PERSONAS, PLAYER_1, UID, memberDoc, rosterDoc } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, setUpGuildEmulator, stored } from './support/harness.ts'

setUpGuildEmulator()

async function linkMember() {
  await asAdmin(async (db) => {
    await updateDoc(guildDoc(db, `members/${UID.member}`), { playerId: PLAYER_1 })
    await updateDoc(guildDoc(db, `roster/${PLAYER_1}`), { linkedUid: UID.member })
  })
}

const remove = () => setMembershipRemoved(dbFor('guildLeader'), GUILD_ID, UID.member, true)
const restore = () => setMembershipRemoved(dbFor('guildLeader'), GUILD_ID, UID.member, false)

describe('removing and restoring member access', () => {
  test('the real client transaction removes access and the reciprocal link without deleting records', async () => {
    await linkMember()
    const paths = [`roster/${PLAYER_1}`, `teamAssignments/${PLAYER_1}`, 'awards/award-1', 'lootPriorities/priority-1', 'raids/raid-1', 'afkEntries/afk-member']
    const originals = await Promise.all(paths.map(stored))
    await expectAllowed(remove())
    assert.equal((await stored(`members/${UID.member}`))?.role, 'Removed')
    assert.equal((await stored(`members/${UID.member}`))?.playerId, null)
    for (const [index, path] of paths.entries()) {
      const expected = { ...originals[index] }
      if (path === `roster/${PLAYER_1}`) delete expected.linkedUid
      assert.deepEqual(await stored(path), expected)
    }
  })

  test('restore grants only Member access and requires a separate explicit character link', async () => {
    await linkMember()
    await remove()
    await expectAllowed(restore())
    assert.equal((await stored(`members/${UID.member}`))?.role, 'Member')
    assert.equal((await stored(`members/${UID.member}`))?.playerId, null)
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, undefined)
    await expectAllowed(getDocFromServer(guildDoc(dbFor('member'), `roster/${PLAYER_1}`)))
    const batch = writeBatch(dbFor('guildLeader'))
    batch.update(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { playerId: PLAYER_1 })
    batch.update(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`), { linkedUid: UID.member })
    await expectAllowed(batch.commit())
  })

  for (const who of PERSONAS.filter((who) => who !== 'guildLeader')) {
    for (const removed of [true, false]) {
      test(`${who} cannot ${removed ? 'remove' : 'restore'} an account`, async () => {
        if (!removed) await remove()
        await expectDenied(setMembershipRemoved(dbFor(who), GUILD_ID, UID.member, removed))
      })
    }
  }

  test('a Guild Leader cannot remove their own access, even with a direct write', async () => {
    await expectDenied(setMembershipRemoved(dbFor('guildLeader'), GUILD_ID, UID.guildLeader, true))
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.guildLeader}`), { role: 'Removed', playerId: null }))
  })

  test('removal must release a linked character in the same atomic write', async () => {
    await linkMember()
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { role: 'Removed', playerId: null }))
    assert.equal((await stored(`members/${UID.member}`))?.role, 'Member')
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, UID.member)
  })

  test('removal cannot keep a reciprocal link even in a forged batch', async () => {
    await linkMember()
    await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { role: 'Removed' }))
  })

  for (const role of ['Guild Leader', 'Raid Leader']) {
    test(`a removed account cannot be restored directly as ${role}`, async () => {
      await remove()
      await expectDenied(updateDoc(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { role }))
    })
  }

  test('a removed account cannot be linked during restoration', async () => {
    await remove()
    const batch = writeBatch(dbFor('guildLeader'))
    batch.update(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { role: 'Member', playerId: PLAYER_1 })
    batch.update(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`), { linkedUid: UID.member })
    await expectDenied(batch.commit())
  })

  test('a removed account cannot be linked while staying Removed', async () => {
    await remove()
    const batch = writeBatch(dbFor('guildLeader'))
    batch.update(guildDoc(dbFor('guildLeader'), `members/${UID.member}`), { playerId: PLAYER_1 })
    batch.update(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`), { linkedUid: UID.member })
    await expectDenied(batch.commit())
  })

  test('removed accounts cannot promote or restore themselves', async () => {
    await remove()
    for (const role of ['Member', 'Raid Leader', 'Guild Leader']) {
      await expectDenied(updateDoc(guildDoc(dbFor('member'), `members/${UID.member}`), { role }))
    }
  })

  test('stale duplicate actions fail explicitly without changing state', async () => {
    await remove()
    await assert.rejects(remove(), /already removed/)
    await restore()
    await assert.rejects(restore(), /no longer removed/)
    assert.equal((await stored(`members/${UID.member}`))?.role, 'Member')
  })

  test('missing accounts fail explicitly', async () => {
    await assert.rejects(setMembershipRemoved(dbFor('guildLeader'), GUILD_ID, 'missing', true), /no longer exists/)
  })

  test('new accounts cannot be provisioned directly as Removed', async () => {
    await expectDenied(setDoc(guildDoc(dbFor('guildLeader'), 'members/new-member'), memberDoc('new-member', 'Member', null, { role: 'Removed' })))
  })
})

describe('Removed is not an authorized guild role', () => {
  for (const previous of ['Member', 'Raid Leader', 'Guild Leader'] as const) {
    test(`a removed former ${previous} loses guild reads and writes while retaining their own access record`, async () => {
      await asAdmin((db) => updateDoc(guildDoc(db, `members/${UID.member}`), { role: previous }))
      const client = dbFor('member')
      await expectAllowed(getDocFromServer(guildDoc(client, `roster/${PLAYER_1}`)))
      await remove()
      await expectAllowed(getDocFromServer(guildDoc(client, `members/${UID.member}`)))
      for (const path of [
        `roster/${PLAYER_1}`, `teamAssignments/${PLAYER_1}`, 'raidZones/zone-1', 'settings/general',
        'lootPriorities/priority-1', 'awards/award-1', 'auditLog/entry-1',
        'afkEntries/afk-member', `publicComments/${UID.member}`, `leaderComments/${UID.member}`,
        `raiderTypes/${UID.member}`, 'raids/raid-1', `raids/raid-1/signups/${UID.member}`,
      ]) {
        await expectDenied(getDocFromServer(guildDoc(client, path)), `reading ${path}`)
        await expectDenied(setDoc(guildDoc(client, path), { role: 'Guild Leader' }), `writing ${path}`)
        await expectDenied(deleteDoc(guildDoc(client, path)), `deleting ${path}`)
      }
      await expectDenied(getDocs(guildCollection(client, 'roster')))
      await expectDenied(getDocs(guildCollection(client, 'members')))
      await expectDenied(setDoc(guildDoc(client, 'roster/new-character'), rosterDoc('new')))
    })
  }

  test('the old character may be assigned to someone else without restoring the removed account', async () => {
    await linkMember()
    await remove()
    const batch = writeBatch(dbFor('guildLeader'))
    batch.update(guildDoc(dbFor('guildLeader'), `members/${UID.raidLeader}`), { playerId: PLAYER_1 })
    batch.update(guildDoc(dbFor('guildLeader'), `roster/${PLAYER_1}`), { linkedUid: UID.raidLeader })
    await expectAllowed(batch.commit())
    await restore()
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, UID.raidLeader)
    assert.equal((await stored(`members/${UID.member}`))?.playerId, null)
  })

  test('removing an unlinked member does not change unrelated roster links', async () => {
    await asAdmin((db) => updateDoc(guildDoc(db, `roster/${PLAYER_1}`), { linkedUid: UID.raidLeader }))
    await remove()
    assert.equal((await stored(`roster/${PLAYER_1}`))?.linkedUid, UID.raidLeader)
  })
})
