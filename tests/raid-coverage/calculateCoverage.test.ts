import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage, summaryText, validateEffects } from '../../src/features/raid-coverage/calculateCoverage.ts'
import { coverageEffects } from '../../src/features/raid-coverage/coverageData.ts'
import { assignedMembers, coverageTargets } from '../../src/features/raid-coverage/teamSelection.ts'
import type { TenManTeam } from '../../src/guildApi.ts'
import { namedTeams } from '../../src/shared/game/teams.ts'
import type { CoverageEffect, CoverageMember } from '../../src/features/raid-coverage/types.ts'

// Invented effects and players: these test the engine, not the game.
const effect = (over: Partial<CoverageEffect> & Pick<CoverageEffect, 'id' | 'kind'>): CoverageEffect => ({
  name: over.id,
  providers: [{ className: 'Alpha' }],
  confidence: 'confirmed',
  scopeStatus: 'confirmed',
  sources: ['test'],
  verifiedOn: '2026-01-01',
  ...over,
})
const member = (id: string, className: string, specialization = ''): CoverageMember => ({ id, name: `Player ${id}`, className, specialization })
const only = (effects: CoverageEffect[], members: CoverageMember[]) => calculateCoverage(effects, members).requirements[0]

describe('status', () => {
  it('is Available when a confirmed provider is present, and Missing when none is', () => {
    const raid = effect({ id: 'raid', kind: 'raid-buff' })
    assert.equal(only([raid], [member('1', 'Alpha')]).status, 'available')
    assert.equal(only([raid], [member('1', 'Beta')]).status, 'missing')
    assert.equal(only([raid], []).status, 'missing')
  })

  it('matches class and spec case-insensitively, and any spec when none is listed', () => {
    const spec = effect({ id: 's', kind: 'debuff', providers: [{ className: 'Alpha', specs: ['Fury'] }] })
    assert.equal(only([spec], [member('1', 'alpha', ' fury ')]).status, 'available')
    assert.equal(only([spec], [member('1', 'Alpha', 'Arms')]).status, 'missing')
    assert.equal(only([spec], [member('1', 'Alpha', '')]).status, 'potential')
  })

  it('is Potential when only talent providers exist, Available once a talent-free one does', () => {
    const talent = effect({ id: 't', kind: 'raid-buff', providers: [{ className: 'Alpha', talent: 'Deep Thing' }] })
    const result = only([talent], [member('1', 'Alpha')])
    assert.equal(result.status, 'potential')
    assert.equal(result.matches[0].talent, 'Deep Thing')
    const mixed = effect({ id: 'm', kind: 'raid-buff', providers: [{ className: 'Alpha', talent: 'Deep Thing' }, { className: 'Beta' }] })
    assert.equal(only([mixed], [member('1', 'Alpha'), member('2', 'Beta')]).status, 'available')
  })

  it('prefers the talent-free provider for one player and never matches them twice', () => {
    const e = effect({ id: 'e', kind: 'raid-buff', providers: [{ className: 'Alpha', talent: 'X' }, { className: 'Alpha' }] })
    const result = only([e], [member('1', 'Alpha')])
    assert.equal(result.status, 'available')
    assert.equal(result.matches.length, 1)
  })

  it('shows party buffs as Party Unknown whatever the roster holds', () => {
    const party = effect({ id: 'p', kind: 'party-buff' })
    assert.equal(only([party], [member('1', 'Alpha')]).status, 'party-unknown')
    assert.equal(only([party], []).status, 'party-unknown')
    assert.equal(only([party], [member('1', 'Alpha')]).matches.length, 1)
  })

  it('lists eligible providers for a targeted buff without claiming everyone is covered', () => {
    const targeted = effect({ id: 'tb', kind: 'targeted-buff' })
    const result = only([targeted], [member('1', 'Alpha'), member('2', 'Alpha'), member('3', 'Beta')])
    assert.equal(result.status, 'available')
    assert.deepEqual(result.matches.map((match) => match.playerId), ['1', '2'])
  })
})

describe('unverified data', () => {
  it('keeps provisional or unverified effects out of confirmed coverage', () => {
    for (const over of [{ confidence: 'unverified' }, { confidence: 'provisional' }, { scopeStatus: 'unknown' }, { scopeStatus: 'provisional' }] as const) {
      const result = only([effect({ id: 'u', kind: 'raid-buff', ...over })], [member('1', 'Alpha')])
      assert.equal(result.status, 'unverified')
      assert.equal(result.matches[0].confirmed, false)
    }
  })

  it('does not turn an unverified party buff into Party Unknown', () => {
    assert.equal(only([effect({ id: 'u', kind: 'party-buff', confidence: 'unverified' })], []).status, 'unverified')
  })

  it('ignores unverified alternatives when judging a confirmed requirement', () => {
    const effects = [
      effect({ id: 'a', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Alpha' }] }),
      effect({ id: 'b', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Beta' }], confidence: 'unverified' }),
    ]
    const result = only(effects, [member('1', 'Beta')])
    assert.equal(result.status, 'missing')
    assert.equal(result.matches.length, 1)
    assert.equal(result.matches[0].confirmed, false)
  })
})

describe('alternative and non-stacking providers', () => {
  const effects = [
    effect({ id: 'a', name: 'Buff A', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Alpha' }] }),
    effect({ id: 'b', name: 'Buff B', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Beta' }] }),
  ]

  it('counts a stack group as one requirement', () => {
    const report = calculateCoverage(effects, [member('1', 'Alpha'), member('2', 'Beta')])
    assert.equal(report.requirements.length, 1)
    assert.equal(report.summary.available, 1)
    assert.equal(report.requirements[0].name, 'Buff A / Buff B')
    assert.equal(report.requirements[0].matches.length, 2)
  })

  it('is covered by either alternative and missing when neither is present', () => {
    assert.equal(only(effects, [member('1', 'Beta')]).status, 'available')
    assert.equal(only(effects, [member('1', 'Gamma')]).status, 'missing')
  })

  it('counts a requirement once however many providers there are', () => {
    const report = calculateCoverage(effects, Array.from({ length: 6 }, (_, i) => member(String(i), 'Alpha')))
    assert.equal(report.summary.available, 1)
  })
})

describe('minimum provider requirement', () => {
  const req = (over: Partial<CoverageEffect> = {}) => effect({ id: 'r', kind: 'raid-buff', requirement: 2, ...over })

  it('defaults to one provider', () => {
    const result = only([effect({ id: 'd', kind: 'raid-buff' })], [member('1', 'Alpha')])
    assert.equal(result.required, 1)
    assert.equal(result.status, 'available')
  })

  it('is Missing with too few providers and Available once enough different players match', () => {
    assert.equal(only([req()], [member('1', 'Alpha')]).status, 'missing')
    assert.equal(only([req()], [member('1', 'Alpha'), member('2', 'Alpha')]).status, 'available')
  })

  it('counts a player once even when they match several alternatives', () => {
    const group = [
      req({ id: 'a', stackGroup: 'g', providers: [{ className: 'Alpha' }] }),
      req({ id: 'b', stackGroup: 'g', providers: [{ className: 'Alpha' }, { className: 'Beta' }] }),
    ]
    assert.equal(only(group, [member('1', 'Alpha')]).status, 'missing')
    assert.equal(only(group, [member('1', 'Alpha'), member('2', 'Beta')]).status, 'available')
  })

  it('does not let talent providers satisfy it, but reports Potential when they could', () => {
    const talent = req({ providers: [{ className: 'Alpha', talent: 'T' }] })
    const result = only([talent], [member('1', 'Alpha'), member('2', 'Alpha')])
    assert.equal(result.status, 'potential')
    assert.equal(result.availableCount, 0)
    assert.equal(result.potentialCount, 2)
    const partial = req({ providers: [{ className: 'Alpha' }, { className: 'Beta', talent: 'T' }] })
    assert.equal(only([partial], [member('1', 'Alpha'), member('2', 'Beta')]).status, 'potential')
    assert.equal(only([partial], [member('1', 'Beta')]).status, 'missing')
  })

  it('does not let unverified providers satisfy a confirmed requirement', () => {
    const group = [
      req({ id: 'a', stackGroup: 'g', providers: [{ className: 'Alpha' }] }),
      req({ id: 'b', stackGroup: 'g', providers: [{ className: 'Beta' }], confidence: 'unverified' }),
    ]
    const result = only(group, [member('1', 'Alpha'), member('2', 'Beta')])
    assert.equal(result.status, 'missing')
    assert.equal(result.availableCount, 1)
    assert.equal(result.matches.length, 2)
    assert.equal(result.matches.filter((match) => match.confirmed).length, 1)
  })

  it('uses the largest requirement among a group\'s confirmed effects and ignores unverified ones', () => {
    const group = [
      effect({ id: 'a', kind: 'raid-buff', stackGroup: 'g' }),
      effect({ id: 'b', kind: 'raid-buff', stackGroup: 'g', requirement: 3, confidence: 'unverified' }),
    ]
    assert.equal(only(group, [member('1', 'Alpha')]).required, 1)
  })

  it('does not change Party Unknown or Unverified', () => {
    assert.equal(only([req({ kind: 'party-buff' })], [member('1', 'Alpha'), member('2', 'Alpha')]).status, 'party-unknown')
    assert.equal(only([req({ confidence: 'unverified' })], [member('1', 'Alpha'), member('2', 'Alpha')]).status, 'unverified')
  })
})

describe('duplicates, empty data and extra cases', () => {
  it('counts a player listed twice once', () => {
    const report = calculateCoverage([effect({ id: 'a', kind: 'raid-buff', requirement: 2 })], [member('1', 'Alpha'), member('1', 'Alpha')])
    assert.equal(report.memberCount, 1)
    assert.equal(report.requirements[0].status, 'missing')
  })

  it('assignedMembers drops duplicate player ids', () => {
    const list = assignedMembers(['blue'], [member('1', 'Alpha'), member('1', 'Alpha')], { 1: 'blue' })
    assert.equal(list.length, 1)
  })

  it('handles an empty catalog and says so instead of showing counts', () => {
    const report = calculateCoverage([], [member('1', 'Alpha')])
    assert.deepEqual(report.requirements, [])
    assert.equal(report.confirmedCount, 0)
    assert.equal(summaryText(report), 'No coverage data yet')
  })

  it('shows no counts when every entry is unverified', () => {
    const report = calculateCoverage([effect({ id: 'u', kind: 'raid-buff', confidence: 'unverified' })], [member('1', 'Alpha')])
    assert.equal(report.confirmedCount, 0)
    assert.equal(summaryText(report), 'No confirmed coverage data yet (1 unverified)')
  })

  it('shows counts once something is confirmed', () => {
    const report = calculateCoverage([
      effect({ id: 'a', kind: 'raid-buff' }),
      effect({ id: 'u', kind: 'raid-buff', confidence: 'unverified' }),
      effect({ id: 'p', kind: 'party-buff' }),
    ], [member('1', 'Alpha')])
    assert.equal(summaryText(report), '1 available, 0 missing, 0 potential, 1 party unknown, 1 unverified')
  })

  it('matches the Combat Rogue spec', () => {
    const e = effect({ id: 'c', kind: 'debuff', providers: [{ className: 'Rogue', specs: ['Combat'] }] })
    assert.equal(only([e], [member('1', 'Rogue', 'Combat')]).status, 'available')
    assert.equal(only([e], [member('1', 'Rogue', 'Assassination')]).status, 'missing')
  })

  it('reports how many different players are eligible for a targeted buff', () => {
    const result = only([effect({ id: 'tb', kind: 'targeted-buff' })], [member('1', 'Alpha'), member('2', 'Alpha'), member('3', 'Beta')])
    assert.equal(result.availableCount, 2)
    assert.equal(result.potentialCount, 2)
    assert.equal(new Set(result.matches.map((match) => match.playerId)).size, 2)
  })

  it('marks mixed-group matches so unverified ones are told apart', () => {
    const group = [
      effect({ id: 'a', kind: 'raid-buff', stackGroup: 'g' }),
      effect({ id: 'b', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Beta' }], scopeStatus: 'unknown' }),
    ]
    const result = only(group, [member('1', 'Beta')])
    assert.equal(result.status, 'missing')
    assert.deepEqual(result.matches.map((match) => match.confirmed), [false])
  })
})

describe('summary', () => {
  it('counts each status', () => {
    const report = calculateCoverage([
      effect({ id: '1', kind: 'raid-buff' }),
      effect({ id: '2', kind: 'debuff', providers: [{ className: 'Beta' }] }),
      effect({ id: '3', kind: 'raid-buff', providers: [{ className: 'Alpha', talent: 'T' }] }),
      effect({ id: '4', kind: 'party-buff' }),
      effect({ id: '5', kind: 'raid-buff', confidence: 'unverified' }),
    ], [member('1', 'Alpha')])
    assert.deepEqual(report.summary, { available: 1, contested: 0, indeterminate: 0, missing: 1, potential: 1, 'party-unknown': 1, unverified: 1 })
    assert.equal(report.memberCount, 1)
  })
})

describe('team selection', () => {
  const teams = namedTeams({ blue: 'Blue', yellow: 'Yellow', red: 'Red', white: 'White' })
  const groupNames = { green: 'Green', pink: 'Pink', brown: 'Brown' }
  const players = ['a', 'b', 'c', 'd', 'e'].map((id) => member(id, 'Alpha'))
  const assignments: Record<string, TenManTeam> = { a: 'blue', b: 'yellow', c: 'red', d: 'white' }

  it('offers the right targets for 10, 20 and 40 player views', () => {
    assert.deepEqual(coverageTargets(10, teams, groupNames).map((t) => t.name), ['Blue', 'Yellow', 'Red', 'White'])
    assert.deepEqual(coverageTargets(20, teams, groupNames).map((t) => t.name), ['Green', 'Pink'])
    assert.deepEqual(coverageTargets(40, teams, groupNames).map((t) => t.name), ['Brown'])
  })

  it('uses only players assigned to the selected team or group', () => {
    const ids = (view: 10 | 20 | 40, index: number) => {
      const target = coverageTargets(view, teams, groupNames)[index]
      return assignedMembers(target.parts, players, assignments).map((p) => p.id)
    }
    assert.deepEqual(ids(10, 0), ['a'])
    assert.deepEqual(ids(20, 0), ['a', 'b'])
    assert.deepEqual(ids(20, 1), ['c', 'd'])
    assert.deepEqual(ids(40, 0), ['a', 'b', 'c', 'd'])
  })

  it('never includes unassigned players', () => {
    const all = assignedMembers(coverageTargets(40, teams, groupNames)[0].parts, players, assignments)
    assert.ok(!all.some((p) => p.id === 'e'))
  })
})

describe('data file', () => {
  it('has no validation problems', () => {
    assert.deepEqual(validateEffects(coverageEffects), [])
  })

  it('validation catches bad requirement, spellId and party-buff requirements', () => {
    const problems = validateEffects([
      effect({ id: 'r0', kind: 'raid-buff', requirement: 0 }),
      effect({ id: 'r1', kind: 'raid-buff', requirement: 1.5 }),
      effect({ id: 's', kind: 'raid-buff', spellId: -4 }),
      effect({ id: 'p', kind: 'party-buff', requirement: 2 }),
      effect({ id: 'ok', kind: 'raid-buff', requirement: 2, spellId: 123, category: 'offensive' }),
    ]).join('\n')
    assert.match(problems, /r0: requirement/)
    assert.match(problems, /r1: requirement/)
    assert.match(problems, /s: spellId/)
    assert.match(problems, /p: a party buff cannot have a provider requirement/)
    assert.doesNotMatch(problems, /ok:/)
  })

  it('validation catches missing sources, duplicate ids, bad dates and mixed stack groups', () => {
    const bad = [
      effect({ id: 'x', kind: 'raid-buff', sources: [], stackGroup: 'g' }),
      effect({ id: 'x', kind: 'debuff', stackGroup: 'g', verifiedOn: 'soon' }),
      effect({ id: 'y', kind: 'raid-buff', verifiedOn: undefined }),
    ]
    const problems = validateEffects(bad).join('\n')
    assert.match(problems, /Duplicate id: x/)
    assert.match(problems, /x: no source/)
    assert.match(problems, /verifiedOn must be YYYY-MM-DD/)
    assert.match(problems, /stack group mixes kinds/)
    assert.match(problems, /y: confirmed entries need verifiedOn/)
  })
})
