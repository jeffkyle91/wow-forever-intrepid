import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { PlayerRecord } from '../../src/shared/game/players.ts'
import type { RaidSignup } from '../../src/raidSignups.ts'
import { characterAccount, lineupWarnings, placementWarnings, readScheduledRoster, scheduledAvailableCharacters, scheduledCandidates, scheduledResponseSummary, scheduledRosterGroups } from '../../src/shared/raids/planning.ts'
import { responseOverview } from '../../src/features/leadership/overview.ts'

const main: PlayerRecord = { id: 'main', name: 'Aldric', linkedUid: 'account', className: 'Warrior', specialization: 'Arms', role: 'Melee' }
const alt: PlayerRecord = { id: 'alt', name: 'Elowen', mainId: 'main', className: 'Druid', specialization: 'Restoration', role: 'Healer' }
const roster = [main, alt]
const ready = roster.map((entry) => ({ id: entry.id, ready: true }))
const state = () => ({
  schemaVersion: 1, revision: 1, invitations: [{ uid: 'account', mainId: 'main' }],
  lineups: [
    { size: 10, teams: ['blue', 'yellow', 'red', 'white'].map((key) => ({ key, name: key, characterIds: key === 'blue' ? ['main'] : [] })), bench: [] },
    { size: 20, teams: ['green', 'pink'].map((key) => ({ key, name: key, characterIds: [] })), bench: [] },
    { size: 40, teams: [{ key: 'brown', name: 'brown', characterIds: [] }], bench: [] },
  ],
})

describe('scheduled roster parsing', () => {
  test('preserves separate sizes and validates the stored contract', () => {
    assert.deepEqual(readScheduledRoster(state()), state())
    assert.equal(readScheduledRoster(null), null)
    assert.equal(readScheduledRoster({ ...state(), schemaVersion: 2 }), null)
    assert.equal(readScheduledRoster({ ...state(), revision: 0 }), null)
    assert.equal(readScheduledRoster({ ...state(), revision: 1.5 }), null)
    assert.equal(readScheduledRoster({ ...state(), invitations: [{ uid: 'account', mainId: 'main' }, { uid: 'account', mainId: 'alt' }] }), null)
    assert.equal(readScheduledRoster({ ...state(), lineups: [] }), null)
  })
  test('rejects malformed teams, duplicate sizes and duplicate placements', () => {
    const duplicate = state()
    duplicate.lineups[0].bench = ['main']
    assert.equal(readScheduledRoster(duplicate), null)
    const unknown = state()
    unknown.lineups[0].teams[0].key = 'forged'
    assert.equal(readScheduledRoster(unknown), null)
    const sizes = state()
    sizes.lineups[1].size = 10
    assert.equal(readScheduledRoster(sizes), null)
    const missing = state()
    missing.lineups[0].teams.pop()
    assert.equal(readScheduledRoster(missing), null)
  })
})

describe('character choices and warnings', () => {
  test('ready main before response; only selected character after response', () => {
    assert.deepEqual(scheduledCandidates(roster, ready, []).map((entry) => entry.id), ['main'])
    assert.deepEqual(scheduledCandidates(roster, ready, [{ id: 'account', characterId: 'alt', status: 'bench', benchKind: 'self' }]).map((entry) => entry.id), ['alt'])
    assert.deepEqual(scheduledCandidates(roster, [{ id: 'alt', ready: true }], []), [])
    assert.deepEqual(scheduledCandidates(roster, [], [{ id: 'account', characterId: 'alt', status: 'accept' }]), [])
  })
  test('foreign and nested links are not choices', () => {
    assert.equal(characterAccount('alt', [main, { ...alt, linkedUid: 'other' }]), undefined)
    assert.equal(characterAccount('alt', [{ ...main, mainId: 'someone' }, alt]), undefined)
    assert.deepEqual(scheduledCandidates([{ ...main, linkedUid: undefined }, alt], ready, []), [])
  })
  test('mismatch, unready main, unready selected character and inclusive unavailability warn', () => {
    const notes = placementWarnings('main', roster, [{ id: 'alt', ready: true }], [{ id: 'account', characterId: 'alt', status: 'accept' }], [{ userId: 'account', startDate: '2090-01-01', endDate: '2090-01-02' }], '2090-01-02')
    assert.equal(notes.length, 4)
    assert(notes.some((note) => note.includes('Signed up as Elowen')))
    assert(notes.includes('Absent or unavailable'))
    assert.deepEqual(placementWarnings('missing', roster, ready, [], [], ''), ['Character no longer on roster'])
  })
  test('duplicate players are invalid only within an individual team', () => {
    const lineup = readScheduledRoster(state())!.lineups[0]
    lineup.teams[1].characterIds = ['alt']
    assert.deepEqual(lineupWarnings({ ...lineup, size: 10 }, roster), [])
    lineup.teams[0].characterIds.push('alt')
    assert.equal(lineupWarnings({ ...lineup, size: 10 }, roster).length, 1)
  })
})

describe('scheduled team response summaries', () => {
  test('matches the requested format and counts only the displayed team characters', () => {
    const players = Array.from({ length: 10 }, (_, index) => ({ ...main, id: `character-${index}`, linkedUid: `account-${index}` }))
    const responses: RaidSignup[] = [
      { id: 'account-0', characterId: 'character-0', status: 'accept' },
      { id: 'account-1', characterId: 'character-1', status: 'tentative' },
      { id: 'outside', characterId: 'outside', status: 'absent' },
    ]
    assert.equal(scheduledResponseSummary(players.map((player) => player.id), [], players, responses), '1 Accepted / 1 Tentative / 0 Absent / 8 Not Responded')
    assert.equal(scheduledResponseSummary([], [], players, responses), '0 Accepted / 0 Tentative / 0 Absent / 0 Not Responded')
  })
  test('includes Absent, Late and voluntary Bench without mislabelling them as unanswered', () => {
    const players = ['absent', 'late', 'bench'].map((status) => ({ ...main, id: status, linkedUid: status }))
    assert.equal(scheduledResponseSummary(players.map((player) => player.id), [], players, [
      { id: 'absent', characterId: 'absent', status: 'absent' },
      { id: 'late', characterId: 'late', status: 'late' },
      { id: 'bench', characterId: 'bench', status: 'bench', benchKind: 'self' },
    ]), '0 Accepted / 0 Tentative / 1 Absent / 1 Late / 1 Bench (voluntary) / 0 Not Responded')
  })
  test('uses account responses for alt mismatches and retained invitations with missing characters', () => {
    assert.equal(scheduledResponseSummary(['main'], state().invitations, roster, [{ id: 'account', characterId: 'alt', status: 'accept' }]), '1 Accepted / 0 Tentative / 0 Absent / 0 Not Responded')
    assert.equal(scheduledResponseSummary(['main'], state().invitations, [], [{ id: 'account', characterId: 'main', status: 'absent' }]), '0 Accepted / 0 Tentative / 1 Absent / 0 Not Responded')
  })
})

describe('scheduled workbench available roster', () => {
  test('scopes the pool to invitations, not the whole guild', () => {
    const outsider = { ...main, id: 'outside', linkedUid: 'outside-account' }
    const lineup = readScheduledRoster(state())!.lineups[1]
    assert.deepEqual(scheduledAvailableCharacters(lineup, state().invitations, [...roster, outsider], []).map((character) => character.id), ['main'])
  })
  test('exposes a selected alt even while the copied main remains assigned', () => {
    const lineup = readScheduledRoster(state())!.lineups[0]
    const response: RaidSignup[] = [{ id: 'account', characterId: 'alt', status: 'accept' }]
    assert.deepEqual(scheduledAvailableCharacters(lineup, state().invitations, roster, response).map((character) => character.id), ['alt'])
    assert.deepEqual(lineup.teams[0].characterIds, ['main'])
    lineup.bench.push('alt')
    assert.deepEqual(scheduledAvailableCharacters(lineup, state().invitations, roster, response), [])
  })
  test('keeps absent and unready invitees visible while placement eligibility stays separate', () => {
    const lineup = readScheduledRoster(state())!.lineups[1]
    const response: RaidSignup[] = [{ id: 'account', characterId: 'alt', status: 'absent' }]
    assert.deepEqual(scheduledAvailableCharacters(lineup, state().invitations, roster, response).map((character) => character.id), ['alt'])
    assert.deepEqual(scheduledCandidates(roster, [], response), [])
  })
  test('uses each independent size without mutating any lineup', () => {
    const plan = readScheduledRoster(state())!
    const before = structuredClone(plan)
    assert.deepEqual(plan.lineups.map((lineup) => scheduledAvailableCharacters(lineup, plan.invitations, roster, []).map((character) => character.id)), [[], ['main'], ['main']])
    assert.deepEqual(plan, before)
  })
  test('does not expose another account through a stale or foreign response', () => {
    const lineup = readScheduledRoster(state())!.lineups[1]
    const foreign = { ...main, id: 'foreign', linkedUid: 'someone' }
    assert.deepEqual(scheduledAvailableCharacters(lineup, state().invitations, [...roster, foreign], [{ id: 'account', characterId: 'foreign', status: 'accept' }]).map((character) => character.id), ['main'])
    assert.deepEqual(scheduledAvailableCharacters(lineup, state().invitations, [], []), [])
  })
})

describe('scheduled roster display groups', () => {
  test('shows all invitees regardless of readiness or response, ordered by team, bench and unassigned', () => {
    const reserve = { ...main, id: 'reserve', linkedUid: 'reserve-account', name: 'Briar' }
    const unready = { ...main, id: 'unready', linkedUid: 'unready-account', name: 'Cormac' }
    const absent = { ...main, id: 'absent', linkedUid: 'absent-account', name: 'Delia' }
    const players = [main, reserve, unready, absent]
    const invitations = players.map((player) => ({ uid: player.linkedUid, mainId: player.id }))
    const lineup = readScheduledRoster(state())!.lineups[0]
    lineup.bench.push(reserve.id)
    const groups = scheduledRosterGroups(lineup, invitations, players, [{ id: 'absent-account', characterId: 'absent', status: 'absent' }])
    assert.deepEqual(groups.map((group) => group.key), ['blue', 'yellow', 'red', 'white', 'bench', 'unassigned'])
    assert.deepEqual(groups.map((group) => group.characterIds), [['main'], [], [], [], ['reserve'], ['unready', 'absent']])
  })
  test('retains copied non-invitees and main/alt mismatch positions without listing the same invitee again', () => {
    const lineup = readScheduledRoster(state())!.lineups[0]
    lineup.teams[0].characterIds.push('missing', 'alt')
    const groups = scheduledRosterGroups(lineup, state().invitations, roster, [{ id: 'account', characterId: 'alt', status: 'accept' }])
    assert.deepEqual(groups[0].characterIds, ['main', 'alt', 'missing'])
    assert.deepEqual(groups.at(-1)!.characterIds, [])
    assert.deepEqual(lineup.teams[0].characterIds, ['main', 'missing', 'alt'])
  })
  test('unassigned invitees show their selected alt, or their current main before a response', () => {
    const lineup = readScheduledRoster(state())!.lineups[1]
    assert.deepEqual(scheduledRosterGroups(lineup, state().invitations, roster, []).at(-1)!.characterIds, ['main'])
    assert.deepEqual(scheduledRosterGroups(lineup, state().invitations, roster, [{ id: 'account', characterId: 'alt', status: 'absent' }]).at(-1)!.characterIds, ['alt'])
  })
  test('retains missing/unlinked invitees and never displays another account selected by a stale response', () => {
    const lineup = readScheduledRoster(state())!.lineups[1]
    assert.deepEqual(scheduledRosterGroups(lineup, state().invitations, [], []).at(-1)!.characterIds, ['main'])
    const foreign = { ...main, id: 'foreign', linkedUid: 'other' }
    assert.deepEqual(scheduledRosterGroups(lineup, state().invitations, [...roster, foreign], [{ id: 'account', characterId: 'foreign', status: 'accept' }]).at(-1)!.characterIds, ['main'])
  })
  test('different lineup sizes group their own placements independently', () => {
    const plan = readScheduledRoster(state())!
    assert.deepEqual(scheduledRosterGroups(plan.lineups[0], plan.invitations, roster, []).at(-1)!.characterIds, [])
    assert.deepEqual(scheduledRosterGroups(plan.lineups[1], plan.invitations, roster, []).at(-1)!.characterIds, ['main'])
  })
})

test('Leadership uses persistent main-ready invitations, not any-ready-alt population', () => {
  const members = [{ id: 'account', role: 'Member', playerId: 'main' }]
  const onlyAltReady = [{ id: 'alt', ready: true }]
  assert.equal(responseOverview(members, roster, onlyAltReady, [], []).eligible.length, 0)
  const retained = responseOverview(members, roster, [], [], ['account'])
  assert.equal(retained.missing.length, 1)
  assert.equal(retained.notInvited.length, 0)
  assert.equal(responseOverview([{ ...members[0], role: 'Removed' }], roster, ready, [], ['account']).eligible.length, 0)
})
