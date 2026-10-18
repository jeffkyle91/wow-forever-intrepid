import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { Timestamp } from 'firebase/firestore'
import { responseOverview, upcomingLeadershipRaids } from '../../src/features/leadership/overview.ts'
import { normalizeReadiness } from '../../src/shared/members/readiness.ts'
import type { PlayerRecord } from '../../src/shared/game/players.ts'

const main: PlayerRecord = { id: 'main', name: 'Aldric', className: 'Warrior', specialization: 'Arms', role: 'Melee', linkedUid: 'account' }
const alt: PlayerRecord = { ...main, id: 'alt', name: 'Briar', linkedUid: undefined, mainId: main.id }
const members = [{ id: 'account', role: 'Member', playerId: main.id }]
const roster = [main, alt]
const run = (ready: string[], responses: { id: string; characterId: string; status: string }[] = []) =>
  responseOverview(members, roster, ready.map((id) => ({ id, ready: true })), responses)

describe('leadership readiness and responses', () => {
  test('missing flags exclude accounts without implying they responded', () => {
    const result = run([])
    assert.equal(result.missing.length, 0)
    assert.equal(result.eligible.length, 0)
    assert.equal(result.notReady.length, 1)
  })
  for (const ids of [['main'], ['alt'], ['main', 'alt']]) {
    test(`counts account once when ${ids.join(' and ')} ready`, () => {
      const result = run(ids)
      assert.equal(result.missing.length, 1)
      assert.equal(result.eligible.length, 1)
      assert.equal(result.eligible[0].main?.name, 'Aldric')
      assert.deepEqual(result.eligible[0].ready.map((character) => character.id), ids)
    })
  }
  for (const status of ['accept', 'tentative', 'late', 'absent', 'bench']) {
    for (const characterId of ['main', 'alt']) {
      test(`${status} on ${characterId} counts as response; only attending unready choice warns`, () => {
        const result = run(['alt'], [{ id: 'account', characterId, status }])
        assert.equal(result.missing.length, 0)
        assert.equal(result.warnings.length, characterId === 'main' && ['accept', 'tentative', 'late'].includes(status) ? 1 : 0)
      })
    }
  }
  test('removing last ready flag still surfaces attending response warnings', () => {
    assert.equal(run([], [{ id: 'account', characterId: 'main', status: 'accept' }]).warnings.length, 1)
  })
  test('removed, unlinked and inconsistent links never qualify', () => {
    const result = responseOverview([
      { ...members[0], role: 'Removed' },
      { id: 'unlinked', role: 'Member' },
      { id: 'mismatch', role: 'Member', playerId: 'main' },
    ], roster, [{ id: 'alt', ready: true }], [])
    assert.equal(result.eligible.length, 0)
    assert.equal(result.removed, 1)
    assert.equal(result.unlinked.length, 2)
  })
  test('foreign-linked and indirect alts are not owned', () => {
    const result = responseOverview(members, [main, { ...alt, linkedUid: 'other' }, { ...alt, id: 'nested', mainId: 'alt' }], [{ id: 'alt', ready: true }, { id: 'nested', ready: true }], [])
    assert.equal(result.eligible.length, 0)
  })
  test('main promotion and rename preserve readiness by character ID', () => {
    const result = responseOverview([{ ...members[0], playerId: 'alt' }], [{ ...main, linkedUid: undefined, mainId: 'alt' }, { ...alt, mainId: undefined, linkedUid: 'account', name: 'Renamed' }], [{ id: 'main', ready: true }], [])
    assert.equal(result.missing[0].main?.name, 'Renamed')
    assert.equal(result.missing[0].ready[0].id, 'main')
  })
  test('Guild and Raid Leaders with linked mains are included', () => {
    for (const role of ['Guild Leader', 'Raid Leader']) {
      assert.equal(responseOverview([{ ...members[0], role }], roster, [{ id: 'main', ready: true }], []).missing.length, 1)
    }
  })
})

test('readiness normalization refuses invalid flags and stamps', () => {
  const valid = { ready: false, updatedBy: 'account', updatedAt: Timestamp.fromMillis(10) }
  assert.deepEqual(normalizeReadiness('main', valid), { id: 'main', ...valid })
  for (const change of [{ ready: 'false' }, { updatedBy: '' }, { updatedAt: 10 }]) assert.equal(normalizeReadiness('main', { ...valid, ...change }), null)
})

test('raid selection excludes cancelled and started raids, sorts by instant and supports legacy dates', () => {
  const raid = { date: '2026-12-09', id: 'legacy' }
  const now = Date.parse('2026-12-10T01:00:00Z')
  const raids = [
    { ...raid, id: 'past', startsAt: Timestamp.fromMillis(now - 1) },
    { ...raid, id: 'started', startsAt: Timestamp.fromMillis(now) },
    { ...raid, id: 'cancelled', status: 'cancelled' },
    { ...raid, id: 'later', startsAt: Timestamp.fromMillis(now + 7_200_000) },
    raid,
  ]
  assert.deepEqual(upcomingLeadershipRaids(raids, now).map((entry) => entry.id), ['legacy', 'later'])
  assert.deepEqual(upcomingLeadershipRaids(raids, now + 7_200_000), [])
  assert.deepEqual(upcomingLeadershipRaids([], now), [])
})

test('raid selection respects Eastern legacy times, authoritative timestamps and deterministic ties', () => {
  const now = Date.parse('2026-12-10T01:00:00Z')
  const raids = [
    { id: 'b', date: '2026-12-09', time: '21:00' },
    { id: 'earlier', date: '2026-12-09', time: '20:30' },
    { id: 'a', date: '2026-12-09' },
    { id: 'timestamp', date: '2020-01-01', time: '00:00', startsAt: Timestamp.fromMillis(now + 1) },
  ]
  const original = [...raids]
  assert.deepEqual(upcomingLeadershipRaids(raids, now).map((entry) => entry.id), ['timestamp', 'earlier', 'a', 'b'])
  assert.deepEqual(raids, original)
  assert.throws(() => upcomingLeadershipRaids([{ id: 'invalid', date: 'invalid' }], now), /valid raid date/)
})
