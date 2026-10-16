import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { raidStartDate } from '../src/shared/lib/raidStart.ts'
import { canViewRaidTeam, raidSignupTeam, signupCharacters } from '../src/shared/raids/roster.ts'
import { defaultGuildSettings } from '../src/shared/game/settings.ts'
import type { PlayerRecord } from '../src/guildApi.ts'
import type { RaidSignup } from '../src/raidSignups.ts'

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
