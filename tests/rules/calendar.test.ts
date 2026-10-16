// The Raid Calendar: unavailable dates (afkEntries, called "AFK" in the code) and scheduled raids.
//
// Tests labeled "KNOWN GAP" pin what the rules do today even though it is arguably wrong or weak. When a
// rules change closes a gap, the matching test fails: flip it to expect a denial and drop the label.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { Timestamp, addDoc, deleteDoc, setDoc, updateDoc } from 'firebase/firestore'
import { BYSTANDER, UID, afkDoc, displayNameOf, raidDoc, without } from './support/fixtures.ts'
import { dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, stored, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()

const CLIENT_TIME = Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'))

// match /afkEntries/{entryId}: create
// A member, Raid Leader or Guild Leader adds an entry for themselves. The entry may hold exactly userId,
// displayName, startDate, endDate and createdAt; userId is the caller; displayName is the one in their
// members doc; createdAt is the server's time; and the dates are YYYY-MM-DD strings with start on or before end.
describe('adding unavailable dates', () => {
  const add = (data: Record<string, unknown>) => addDoc(guildCollection(dbFor('member'), 'afkEntries'), data)

  test('a valid entry is accepted and stores what was sent', async () => {
    const ref = await addDoc(guildCollection(dbFor('member'), 'afkEntries'), afkDoc(UID.member))
    const entry = await stored(`afkEntries/${ref.id}`)
    assert.equal(entry?.userId, UID.member)
    assert.equal(entry?.startDate, '2026-12-10')
    assert.equal(entry?.endDate, '2026-12-12')
  })

  test('a single day is allowed: the start may equal the end', async () => {
    await expectAllowed(add(afkDoc(UID.member, { startDate: '2026-12-10', endDate: '2026-12-10' })))
  })

  const refused: [string, Record<string, unknown>][] = [
    ["an entry in someone else's name", afkDoc(BYSTANDER)],
    ["an entry in someone else's name that still carries the caller's displayName", afkDoc(BYSTANDER, { displayName: displayNameOf(UID.member) })],
    ["a displayName that is not the one in the members doc", afkDoc(UID.member, { displayName: 'Somebody Else' })],
    ['no displayName', without(afkDoc(UID.member), 'displayName')],
    ['an extra field', afkDoc(UID.member, { note: 'back soon' })],
    ['a createdAt chosen by the client', afkDoc(UID.member, { createdAt: CLIENT_TIME })],
    ['no createdAt', without(afkDoc(UID.member), 'createdAt')],
    ['a start date after the end date', afkDoc(UID.member, { startDate: '2026-12-12', endDate: '2026-12-10' })],
    ['an empty start date', afkDoc(UID.member, { startDate: '' })],
    ['no end date', without(afkDoc(UID.member), 'endDate')],
    ['a date without zero padding', afkDoc(UID.member, { startDate: '2026-1-5' })],
    ['a date with a time on it', afkDoc(UID.member, { startDate: '2026-12-10T00:00:00' })],
    ['a date that is a number', afkDoc(UID.member, { startDate: 20261210 })],
  ]
  for (const [what, payload] of refused) {
    test(`an entry with ${what} is refused`, async () => {
      await expectDenied(add(payload))
    })
  }

  // The end date has its own format check. These all sort on or after the start date, so the start <= end
  // comparison lets them through and the format check is the only thing that can refuse them. (Cases like an
  // empty or numeric end date fail the comparison anyway and would not show whether the check is there.)
  const badEndDates: [string, Record<string, unknown>][] = [
    ['an end date that is not a date', { endDate: 'not a date' }],
    ['an end date with a time on it', { endDate: '2026-12-12T00:00:00' }],
    ['an end date without zero padding', { startDate: '2026-01-01', endDate: '2026-1-5' }],
  ]
  for (const [what, overrides] of badEndDates) {
    test(`an entry with ${what} is refused`, async () => {
      await expectDenied(add(afkDoc(UID.member, overrides)))
    })
  }

  // KNOWN GAP: dates are checked with a pattern only (four digits, two, two), not as real calendar dates,
  // and a range has no limit. Entries like these reach the calendar, which has to cope with them.
  const impossible: [string, string, string][] = [
    ['February 30th', '2026-02-30', '2026-03-01'],
    ['month 13', '2026-13-01', '2026-13-02'],
    ['year 0000 to year 9999', '0000-00-00', '9999-99-99'],
  ]
  for (const [what, startDate, endDate] of impossible) {
    test(`KNOWN GAP: a range using ${what} is accepted`, async () => {
      await expectAllowed(add(afkDoc(UID.member, { startDate, endDate })))
    })
  }
})

// match /afkEntries/{entryId}: update and delete
// Entries are never edited. Only the person named in the entry can delete it, and only while they are
// still a member of the guild; a Guild Leader cannot delete someone else's (the matrix checks this per role).
describe('changing or removing unavailable dates', () => {
  test('an owner cannot edit their own entry, only delete it', async () => {
    const ref = guildDoc(dbFor('member'), 'afkEntries/afk-member')
    await expectDenied(updateDoc(ref, { endDate: '2026-12-30' }), 'editing')
    await expectDenied(setDoc(ref, afkDoc(UID.member, { endDate: '2026-12-30' })), 'replacing')
    await expectAllowed(deleteDoc(ref), 'deleting')
    assert.equal(await stored('afkEntries/afk-member'), undefined)
  })
})

// match /raids/{raidId}: create
// A Guild Leader or Raid Leader schedules a raid, optionally including a description, time, zones and
// a UTC startsAt timestamp. The date is YYYY-MM-DD, the name 1 to 80 characters, the size 10, 20 or 40;
// createdBy is the caller and createdAt is the server's time. Legacy raids can omit startsAt.
describe('scheduling a raid', () => {
  const schedule = (data: Record<string, unknown>) => addDoc(guildCollection(dbFor('raidLeader'), 'raids'), data)

  for (const size of [10, 20, 40]) {
    test(`a ${size}-player raid is accepted`, async () => {
      await expectAllowed(schedule(raidDoc(UID.raidLeader, { size })))
    })
  }

  test('a name of exactly 80 characters is accepted', async () => {
    await expectAllowed(schedule(raidDoc(UID.raidLeader, { name: 'x'.repeat(80) })))
    await expectAllowed(schedule(raidDoc(UID.raidLeader, { description: 'x'.repeat(500) })))
    await expectAllowed(schedule(raidDoc(UID.raidLeader, { time: '21:00' })))
    await expectAllowed(schedule(raidDoc(UID.raidLeader, { zones: [{ id: 'zone-1', name: 'Barrow Deeps', size: 10 }, { id: 'zone-2', name: 'Hyjal Summit', size: 20 }] })))
    await expectAllowed(schedule(raidDoc(UID.raidLeader, { startsAt: new Date('2026-12-10T02:00:00Z') })))
  })

  const refused: [string, Record<string, unknown>][] = [
    ['a size of 25', raidDoc(UID.raidLeader, { size: 25 })],
    ['a size sent as the string "20"', raidDoc(UID.raidLeader, { size: '20' })],
    ['an empty name', raidDoc(UID.raidLeader, { name: '' })],
    ['a name of 81 characters', raidDoc(UID.raidLeader, { name: 'x'.repeat(81) })],
    ['a name that is a number', raidDoc(UID.raidLeader, { name: 42 })],
    ['a name that is a list', raidDoc(UID.raidLeader, { name: ['Test Raid'] })],
    ['a date in the wrong format', raidDoc(UID.raidLeader, { date: '09/12/2026' })],
    ['a createdBy that is someone else', raidDoc(UID.guildLeader)],
    ['an extra field', raidDoc(UID.raidLeader, { notes: 'bring flasks' })],
    ['a description of 501 characters', raidDoc(UID.raidLeader, { description: 'x'.repeat(501) })],
    ['a time without a leading zero', raidDoc(UID.raidLeader, { time: '9:00' })],
    ['a time of 24:00', raidDoc(UID.raidLeader, { time: '24:00' })],
    ['a time that is a number', raidDoc(UID.raidLeader, { time: 2100 })],
    ['a non-timestamp start instant', raidDoc(UID.raidLeader, { startsAt: '2026-12-10T02:00:00Z' })],
    ['a zone without a valid size', raidDoc(UID.raidLeader, { zones: [{ id: 'zone-1', name: 'Barrow Deeps', size: 25 }] })],
    ['a zone without an id', raidDoc(UID.raidLeader, { zones: [{ name: 'Barrow Deeps', size: 10 }] })],
    ['an empty zone list', raidDoc(UID.raidLeader, { zones: [] })],
    ['an empty description', raidDoc(UID.raidLeader, { description: '' })],
    ['a createdAt chosen by the client', raidDoc(UID.raidLeader, { createdAt: CLIENT_TIME })],
    ['no createdAt', without(raidDoc(UID.raidLeader), 'createdAt')],
  ]
  for (const [what, payload] of refused) {
    test(`a raid with ${what} is refused`, async () => {
      await expectDenied(schedule(payload))
    })
  }

  // KNOWN GAP: same pattern-only date check as availability.
  test('KNOWN GAP: a raid dated February 30th is accepted', async () => {
    await expectAllowed(schedule(raidDoc(UID.raidLeader, { date: '2026-02-30' })))
  })
})

// match /raids/{raidId}: update and delete
// A raid is never deleted. Editing and cancelling are covered in raid-edits.test.ts; here only that the
// creator cannot change it without the audit entry that goes with every edit.
describe('raids cannot be changed without an audit entry, or deleted', () => {
  for (const who of ['raidLeader', 'guildLeader'] as const) {
    test(`the creator (${who}) cannot edit their own raid on its own, or delete it`, async () => {
      const db = dbFor(who)
      const ref = await addDoc(guildCollection(db, 'raids'), raidDoc(UID[who]))
      await expectDenied(updateDoc(ref, { name: 'Renamed' }), 'editing')
      await expectDenied(deleteDoc(ref), 'deleting')
      assert.equal((await stored(`raids/${ref.id}`))?.name, 'Test Raid')
    })
  }
})
