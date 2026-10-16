import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage, summaryText } from '../../src/features/raid-coverage/calculateCoverage.ts'
import { coverageEffects } from '../../src/features/raid-coverage/coverageData.ts'
import { coverageTiles, standardEffects, statusCounts } from '../../src/features/raid-coverage/coverageDisplay.ts'
import type { CoverageEffect, CoverageMember } from '../../src/features/raid-coverage/types.ts'

const effect = (over: Partial<CoverageEffect> & Pick<CoverageEffect, 'id' | 'kind'>): CoverageEffect => ({
  name: over.id,
  providers: [{ className: 'Alpha' }],
  confidence: 'provisional',
  scopeStatus: 'provisional',
  sources: ['test'],
  ...over,
})
const unverified = (over: Partial<CoverageEffect> & Pick<CoverageEffect, 'id' | 'kind'>) => effect({ confidence: 'unverified', scopeStatus: 'unknown', ...over })
const member = (id: string, className: string, specialization = ''): CoverageMember => ({ id, name: `Player ${id}`, className, specialization })
const only = (effects: CoverageEffect[], members: CoverageMember[]) => calculateCoverage(effects, members).requirements[0]

describe('provisional estimates', () => {
  it('estimates Available from a provisional provider while the verified status stays Unverified', () => {
    const r = only([effect({ id: 'a', kind: 'raid-buff' })], [member('1', 'Alpha')])
    assert.equal(r.status, 'unverified')
    assert.equal(r.estimate.status, 'available')
    assert.equal(r.basis, 'estimated')
  })

  it('estimates Missing when no provisional provider is assigned', () => {
    const r = only([effect({ id: 'a', kind: 'raid-buff' })], [member('1', 'Beta')])
    assert.equal(r.estimate.status, 'missing')
    assert.equal(r.status, 'unverified')
  })

  it('estimates Potential, never Available, for a talent-dependent provisional provider', () => {
    const r = only([effect({ id: 'a', kind: 'raid-buff', providers: [{ className: 'Alpha', talent: 'T' }] })], [member('1', 'Alpha')])
    assert.equal(r.estimate.status, 'potential')
  })

  it('estimates Contested for provisional effects sharing a slot', () => {
    const effects = [effect({ id: 'a', kind: 'raid-buff', slot: 's' }), effect({ id: 'b', kind: 'raid-buff', slot: 's' })]
    const report = calculateCoverage(effects, [member('1', 'Alpha')])
    assert.deepEqual(report.requirements.map((r) => r.estimate.status), ['contested', 'contested'])
    assert.ok(report.requirements.every((r) => r.status === 'unverified'))
  })

  it('does not count unassigned players: an empty team estimates Missing', () => {
    assert.equal(only([effect({ id: 'a', kind: 'raid-buff' })], []).estimate.status, 'missing')
  })

  it('keeps party buffs Party Unknown and targeted buffs cautious', () => {
    const r = only([effect({ id: 'a', kind: 'party-buff' })], [member('1', 'Alpha')])
    assert.equal(r.estimate.status, 'party-unknown')
    const tile = coverageTiles([effect({ id: 'a', kind: 'party-buff' })], [member('1', 'Alpha')])[0]
    assert.equal(tile.estimated, false)
    assert.ok(!tile.label.includes('Estimated'))
  })

  it('has verified basis and identical results when every effect is confirmed', () => {
    const r = only([effect({ id: 'a', kind: 'raid-buff', confidence: 'confirmed', scopeStatus: 'confirmed' })], [member('1', 'Alpha')])
    assert.equal(r.basis, 'verified')
    assert.equal(r.status, 'available')
    assert.equal(r.estimate.status, 'available')
  })

  it('labels confirmed results as verified, not estimated', () => {
    const [tile] = coverageTiles([effect({ id: 'a', kind: 'raid-buff', confidence: 'confirmed', scopeStatus: 'confirmed' })], [member('1', 'Alpha')])
    assert.equal(tile.estimated, false)
    assert.ok(!tile.label.includes('Estimated'))
  })
})

describe('mixed-confidence alternatives', () => {
  const group = [
    effect({ id: 'p', kind: 'debuff', stackGroup: 'g', providers: [{ className: 'Alpha' }] }),
    unverified({ id: 'u', kind: 'debuff', stackGroup: 'g', providers: [{ className: 'Beta' }] }),
  ]

  it('never counts an unverified alternative as a provider', () => {
    const r = only(group, [member('1', 'Beta')])
    assert.equal(r.estimate.status, 'missing')
    assert.ok(r.matches.every((m) => !m.estimable || m.className !== 'Beta'))
  })

  it('counts the provisional alternative and omits the unverified class from eligible and team lists', () => {
    const [tile] = coverageTiles(group, [member('1', 'Alpha'), member('2', 'Beta')])
    assert.equal(tile.estimated, true)
    assert.equal(tile.status, 'available')
    assert.deepEqual(tile.providerClasses, ['Alpha'])
    assert.ok(tile.lines.includes('Guaranteed in this team: Alpha (spec not set)'))
    assert.ok(tile.lines.some((l) => l.startsWith('Not counted (unverified)')))
  })

  it('stays Unverified when every alternative is unverified', () => {
    const effects = [unverified({ id: 'a', kind: 'raid-buff', stackGroup: 'g' }), unverified({ id: 'b', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Beta' }] })]
    const r = only(effects, [member('1', 'Alpha'), member('2', 'Beta')])
    assert.equal(r.basis, 'unverified')
    assert.equal(r.estimate.status, 'unverified')
  })

  it('lets provisional and confirmed alternatives combine without double counting', () => {
    const effects = [effect({ id: 'a', kind: 'raid-buff', stackGroup: 'g' }), effect({ id: 'b', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Beta' }], confidence: 'confirmed', scopeStatus: 'confirmed' })]
    const r = only(effects, [member('1', 'Alpha'), member('2', 'Beta')])
    assert.equal(calculateCoverage(effects, [member('1', 'Alpha')]).requirements.length, 1)
    assert.equal(r.basis, 'estimated')
    assert.equal(r.status, 'available')
    assert.equal(r.estimate.status, 'available')
    assert.equal(only(effects, [member('1', 'Alpha')]).status, 'missing')
    assert.equal(only(effects, [member('1', 'Alpha')]).estimate.status, 'available')
  })

  it('does not let a verified-only result stand in for a partly provisional group', () => {
    const effects = [effect({ id: 'a', kind: 'raid-buff', stackGroup: 'g' }), effect({ id: 'b', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Beta' }], confidence: 'confirmed', scopeStatus: 'confirmed' })]
    const r = only(effects, [member('1', 'Beta')])
    assert.equal(r.status, 'available')
    assert.equal(r.basis, 'estimated')
  })
})

describe('summary text', () => {
  it('says Estimated, not confirmed, when estimates exist', () => {
    const report = calculateCoverage([effect({ id: 'a', kind: 'raid-buff' })], [member('1', 'Alpha')])
    assert.equal(report.estimatedCount, 1)
    assert.ok(summaryText(report).startsWith('Estimated: '))
  })

  it('keeps the no-confirmed-data wording when nothing is estimable', () => {
    const report = calculateCoverage([unverified({ id: 'a', kind: 'raid-buff' })], [member('1', 'Alpha')])
    assert.equal(report.estimatedCount, 0)
    assert.ok(summaryText(report).includes('No confirmed coverage data yet'))
  })
})

const team = (rows: [string, string, string][]) => rows.map(([name, className, specialization]) => member(name, className, specialization))
const blue = team([['Aeris', 'Warrior', 'Protection'], ['Bram', 'Warrior', 'Fury'], ['Cyra', 'Priest', 'Holy'], ['Dorn', 'Druid', 'Restoration'], ['Elin', 'Rogue', 'Combat'], ['Fenn', 'Rogue', 'Combat'], ['Gale', 'Mage', 'Fire'], ['Hale', 'Paladin', 'Holy'], ['Iris', 'Hunter', 'Marksmanship'], ['Joss', 'Shaman', 'Elemental']])
const yellow = team([['Kell', 'Warrior', 'Arms'], ['Lira', 'Paladin', 'Protection'], ['Mace', 'Priest', 'Discipline'], ['Nyx', 'Druid', 'Guardian'], ['Orin', 'Rogue', 'Assassination'], ['Pell', 'Mage', 'Frost'], ['Quin', 'Warlock', 'Affliction'], ['Rhea', 'Shaman', 'Restoration'], ['Sage', 'Hunter', 'Beast Mastery'], ['Tarn', 'Druid', 'Balance']])
const statusOf = (members: CoverageMember[]) => Object.fromEntries(calculateCoverage(standardEffects(coverageEffects), members).requirements.map((r) => [r.key, r.estimate.status]))
const countsOf = (members: CoverageMember[]) => calculateCoverage(standardEffects(coverageEffects), members).estimateSummary

describe('real catalog against the seeded Blue and Yellow rosters', () => {
  it('Blue: 18 available, 1 potential, 4 missing, 0 party unknown, 1 unverified (all estimates)', () => {
    const s = countsOf(blue)
    assert.deepEqual([s.available, s.potential, s.missing, s['party-unknown'], s.unverified, s.contested, s.indeterminate], [18, 1, 4, 0, 1, 0, 0])
  })

  it('Yellow: 21 available, 1 potential, 1 missing, 0 party unknown, 1 unverified (all estimates)', () => {
    const s = countsOf(yellow)
    assert.deepEqual([s.available, s.potential, s.missing, s['party-unknown'], s.unverified, s.contested, s.indeterminate], [21, 1, 1, 0, 1, 0, 0])
  })

  it('Blue lacks a Warlock, so both curses are estimated Missing; Yellow has one', () => {
    assert.equal(statusOf(blue)['curse-of-the-elements'], 'missing')
    assert.equal(statusOf(blue)['curse-of-tongues'], 'missing')
    assert.equal(statusOf(yellow)['curse-of-the-elements'], 'available')
    assert.equal(statusOf(yellow)['curse-of-tongues'], 'available')
  })

  it('resolves talent-dependent effects by specialization; only the researched spec assumptions become Estimated Available', () => {
    assert.deepEqual(['trueshot-aura', 'leader-of-the-pack', 'moonkin-form'].map((key) => statusOf(blue)[key]), ['potential', 'missing', 'missing'])
    assert.deepEqual(['trueshot-aura', 'leader-of-the-pack', 'moonkin-form'].map((key) => statusOf(yellow)[key]), ['missing', 'potential', 'available'])
  })

  it('unverified requirements stay Unverified whatever the roster', () => {
    for (const roster of [blue, yellow]) {
      assert.equal(statusOf(roster)['physical-damage-reduction'], 'unverified')
      for (const key of ['valor-of-azeroth', 'heart-of-the-lion', 'judgement', 'fear-protection']) assert.equal(statusOf(roster)[key], undefined, key)
    }
  })

  it('shows no verified results and no verified chips', () => {
    for (const roster of [blue, yellow]) {
      const report = calculateCoverage(standardEffects(coverageEffects), roster)
      assert.equal(report.confirmedCount, 0)
      assert.equal(report.summary.unverified, 24)
      const chips = statusCounts(coverageTiles(coverageEffects, roster))
      assert.ok(chips.filter((c) => c.status === 'available' || c.status === 'missing' || c.status === 'potential').every((c) => c.estimated))
    }
  })

  it('changes when a player is removed: dropping the Warrior makes Battle Shout Missing', () => {
    const without = blue.filter((m) => m.className !== 'Warrior')
    assert.equal(statusOf(blue)['battle-shout'], 'available')
    assert.equal(statusOf(without)['battle-shout'], 'missing')
  })
})
