import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { raidStartDate } from '../src/shared/lib/raidStart.ts'
import { canViewRaidTeam, raidSignupTeam, signupCharacters } from '../src/shared/raids/roster.ts'
import { defaultGuildSettings } from '../src/shared/game/settings.ts'
import type { PlayerRecord } from '../src/guildApi.ts'
import type { RaidSignup } from '../src/raidSignups.ts'
import { effectiveRaidSignups, unavailableOn } from '../src/shared/raids/availability.ts'
import { sameRaidZones } from '../src/shared/raids/zoneSnapshots.ts'

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

function character(id: string, extra: Partial<PlayerRecord> = {}): PlayerRecord {
  return { id, name: id, className: 'Warrior', specialization: 'Arms', role: 'Melee', ...extra }
}
describe('effective unavailable responses', () => {
  const entries = [{ id: 'absence', userId: 'test-member', displayName: 'Invented Member', startDate: '2090-06-10', endDate: '2090-06-12' }]
  const roster = [character('main', { linkedUid: 'test-member' }), character('alt', { mainId: 'main' })]
  test('inclusive ranges affect only their owner and covered dates', () => {
    for (const date of ['2090-06-10', '2090-06-11', '2090-06-12']) assert.equal(unavailableOn(entries, 'test-member', date), true)
    for (const date of ['2090-06-09', '2090-06-13']) assert.equal(unavailableOn(entries, 'test-member', date), false)
    assert.equal(unavailableOn(entries, 'someone-else', '2090-06-11'), false)
  })

  describe('raid zone snapshot equality', () => {
    const zones = [{ id: 'test-zone', name: 'Test Zone', size: 20 as const }]
    test('Firestore map key order does not create a false zone change', () => {
      assert.equal(sameRaidZones(zones, [{ size: 20, name: 'Test Zone', id: 'test-zone' }]), true)
    })
    test('real snapshot changes are detected', () => {
      assert.equal(sameRaidZones(zones, []), false)
      assert.equal(sameRaidZones(zones, [{ ...zones[0], id: 'another-zone' }]), false)
      assert.equal(sameRaidZones(zones, [{ ...zones[0], name: 'Renamed Zone' }]), false)
      assert.equal(sameRaidZones(zones, [{ ...zones[0], size: 40 }]), false)
      assert.equal(sameRaidZones([...zones, { ...zones[0], id: 'second' }], [{ ...zones[0], id: 'second' }, ...zones]), false)
    })
  })
  test('an existing alt response is Absent immediately, without mutating the input', () => {
    const saved: RaidSignup[] = [{ id: 'test-member', characterId: 'alt', status: 'accept' }]
    assert.deepEqual(effectiveRaidSignups(saved, entries, roster, '2090-06-11'), [{ ...saved[0], status: 'absent' }])
    assert.equal(saved[0].status, 'accept')
  })
  test('no saved response uses the main, not every alt, and does not duplicate overlapping events', () => {
    assert.deepEqual(effectiveRaidSignups([], [...entries, ...entries], roster, '2090-06-11'), [{ id: 'test-member', characterId: 'main', status: 'absent' }])
    assert.deepEqual(effectiveRaidSignups([], entries, [], '2090-06-11'), [])
  })
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
describe('signed-up character team preview', () => {
  const roster = [
    character('main', { linkedUid: 'test-member' }),
    character('alt', { mainId: 'main' }),
    character('teammate'),
    character('other-team'),
    character('unassigned'),
  ]
  const assignments = { main: 'blue', alt: 'yellow', teammate: 'yellow', 'other-team': 'red' } as const
  const signup: RaidSignup = { id: 'test-member', characterId: 'alt', status: 'accept' }
  for (const status of ['accept', 'tentative', 'late', 'absent', 'bench'] as const) {
    test(`${status} ${['absent', 'bench'].includes(status) ? 'hides' : 'allows'} team preview`, () => {
      const response = { ...signup, status }
      const expected = !['absent', 'bench'].includes(status)
      assert.equal(canViewRaidTeam(response), expected)
      assert.equal(Boolean(raidSignupTeam(response, roster, assignments, defaultGuildSettings)), expected)
    })
  }
  test('no saved response cannot preview', () => {
    assert.equal(canViewRaidTeam(undefined), false)
    assert.equal(raidSignupTeam(undefined, roster, assignments, defaultGuildSettings), undefined)
  })
  test("shows only the saved character's 10-player team, respecting its custom name", () => {
    const team = raidSignupTeam(signup, roster, assignments, {
      ...defaultGuildSettings, teamNames: { ...defaultGuildSettings.teamNames, yellow: 'Gold' },
    })
    assert.equal(team?.key, 'yellow')
    assert.equal(team?.name, 'Gold')
    assert.deepEqual(team?.players.map((player) => player.id), ['alt', 'teammate'])
  })
  test("unassigned alt does not inherit the main's team", () => {
    assert.equal(raidSignupTeam(signup, roster, { main: 'blue' }, defaultGuildSettings), undefined)
  })
  test('preview follows live assignments', () => {
    const team = raidSignupTeam(signup, roster, { ...assignments, alt: 'red' }, defaultGuildSettings)
    assert.deepEqual(team?.players.map((player) => player.id), ['alt', 'other-team'])
  })
})
