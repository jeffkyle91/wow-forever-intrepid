import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { raidStartDate } from '../src/shared/lib/raidStart.ts'
import { raidPreviewGroups, signupCharacters } from '../src/shared/raids/roster.ts'
import { defaultGuildSettings } from '../src/shared/game/settings.ts'
import type { PlayerRecord, RaidRecord } from '../src/guildApi.ts'

describe('Eastern raid start instants', () => {
  for (const [date, time, expected] of [
    ['2026-12-09', '21:00', '2026-12-10T02:00:00.000Z'],
    ['2026-07-01', '21:00', '2026-07-02T01:00:00.000Z'],
    ['2026-03-08', '01:30', '2026-03-08T06:30:00.000Z'],
    ['2026-03-08', '03:30', '2026-03-08T07:30:00.000Z'],
    ['2026-11-01', '01:30', '2026-11-01T05:30:00.000Z'],
    ['2026-11-01', '02:30', '2026-11-01T07:30:00.000Z'],
    ['2026-12-09', '00:00', '2026-12-09T05:00:00.000Z'],
  ]) {
    test(`${date} ${time} ET converts independently of browser timezone`, () => {
      assert.equal(raidStartDate(date, time).toISOString(), expected)
    })
  }
  for (const [date, time] of [['2026-03-08', '02:30'], ['2026-02-30', '21:00'], ['not-a-date', '21:00'], ['2026-12-09', '24:00']]) {
    test(`rejects invalid/nonexistent ${date} ${time}`, () => { assert.throws(() => raidStartDate(date, time)) })
  }
})

const character = (id: string, extra: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id, className: 'Warrior', specialization: 'Arms', role: 'Melee', ...extra,
})
describe('sign-up character choices', () => {
  test('main comes first, followed only by owned direct alts', () => {
    const roster = [
      character('alt', { mainId: 'main' }),
      character('main', { linkedUid: 'test-member' }),
      character('other', { mainId: 'main', linkedUid: 'test-other-member' }),
      character('nested', { mainId: 'alt' }),
      character('unrelated'),
    ]
    assert.deepEqual(signupCharacters(roster, 'test-member').map((player) => player.id), ['main', 'alt'])
    assert.deepEqual(signupCharacters(roster, ''), [])
    assert.deepEqual(signupCharacters(roster, 'test-other-member'), [])
  })
})
const raid: RaidRecord = { id: 'test-raid', date: '2026-12-09', name: 'Test Raid', size: 20, createdBy: 'test-leader' }
describe('zone sizes automatically include the corresponding groups', () => {
  for (const [size, expected] of [[10, ['blue', 'yellow', 'red', 'white']], [20, ['green', 'pink']], [40, ['brown']]] as const) {
    test(`${size}-player includes every corresponding group`, () => {
      assert.deepEqual(raidPreviewGroups({ ...raid, size }, defaultGuildSettings).map((group) => group.key), expected)
    })
  }
  test('mixed zones include each required group once and respect customized names', () => {
    const groups = raidPreviewGroups({ ...raid, zones: [
      { id: 'zone-a', name: 'Zone A', size: 10 }, { id: 'zone-b', name: 'Zone B', size: 20 },
      { id: 'zone-c', name: 'Zone C', size: 10 }, { id: 'zone-d', name: 'Zone D', size: 40 },
    ] }, { ...defaultGuildSettings, teamNames: { ...defaultGuildSettings.teamNames, blue: 'Azure' } })
    assert.equal(groups.length, 7)
    assert.equal(groups[0].name, 'Azure')
    assert.deepEqual(groups.find((group) => group.key === 'green')?.parts, ['blue', 'yellow'])
    assert.deepEqual(groups.find((group) => group.key === 'brown')?.parts, ['blue', 'yellow', 'red', 'white'])
  })
})
