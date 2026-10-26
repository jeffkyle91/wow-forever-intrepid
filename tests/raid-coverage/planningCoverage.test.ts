import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage, summaryText } from '../../src/shared/raid-coverage/calculateCoverage.ts'
import { coverageEffects } from '../../src/shared/raid-coverage/coverageData.ts'
import { coverageTiles, standardEffects, statusCounts } from '../../src/shared/raid-coverage/coverageDisplay.ts'
import type { CoverageEffect, CoverageMember } from '../../src/shared/raid-coverage/types.ts'

const effect = (over: Partial<CoverageEffect> = {}): CoverageEffect => ({
  id: 'effect', name: 'Test effect', kind: 'raid-buff', providers: [{ className: 'Druid' }],
  confidence: 'unverified', scopeStatus: 'unknown', sources: ['test'], notes: 'Internal research note.', ...over,
})
const member = (id = 'one', specialization = 'Feral'): CoverageMember => ({ id, name: `Player ${id}`, className: 'Druid', specialization })
const plan = (effects: CoverageEffect[], members: CoverageMember[]) => calculateCoverage(effects, members).requirements.map((row) => row.planning)

describe('accepted catalog planning', () => {
  it('uses the same roster outcome at every confidence level without rewriting research metadata', () => {
    for (const confidence of ['confirmed', 'provisional', 'unverified'] as const) {
      for (const scopeStatus of ['confirmed', 'provisional', 'unknown'] as const) {
        const entry = effect({ confidence, scopeStatus })
        const before = structuredClone(entry)
        const report = calculateCoverage([entry], [member()])
        assert.equal(report.requirements[0].planning.status, 'available')
        assert.equal(plan([entry], [])[0].status, 'missing')
        assert.equal(report.requirements[0].effects[0], entry)
        assert.deepEqual(entry, before)
        assert.equal(summaryText(report), '1 available, 0 missing, 0 potential')
        assert.equal(report.requirements[0].matches[0].confirmed, confidence === 'confirmed' && scopeStatus === 'confirmed')
      }
    }
    const research = calculateCoverage([effect()], [member()]).requirements[0]
    assert.equal(research.status, 'unverified')
    assert.equal(research.estimate.status, 'unverified')
    assert.equal(research.basis, 'unverified')
  })

  it('retains specialization restrictions, unreadable builds, talents and explicit assumptions', () => {
    const restricted = effect({ providers: [{ className: 'Druid', specs: ['Feral'] }] })
    assert.equal(plan([restricted], [member()])[0].status, 'available')
    assert.equal(plan([restricted], [member('one', 'Restoration')])[0].status, 'missing')
    assert.equal(plan([restricted], [member('one', '')])[0].status, 'potential')
    const talent = effect({ providers: [{ className: 'Druid', specs: ['Feral', 'Guardian'], talent: 'Test talent', assumed: { specs: ['Feral'], basis: 'Internal research' } }] })
    assert.equal(plan([talent], [member()])[0].status, 'available')
    assert.equal(plan([talent], [member('one', 'Guardian')])[0].status, 'potential')
    assert.equal(plan([talent], [member('one', 'Balance')])[0].status, 'missing')
    assert.equal(plan([effect({ providers: [{ className: 'Druid', talent: 'Test talent' }] })], [member()])[0].status, 'potential')
  })

  it('retains party limitations, targeted scope and per-provider scope alternatives', () => {
    const party = effect({ id: 'party', kind: 'party-buff', stackGroup: 'group' })
    assert.equal(plan([party], [member()])[0].status, 'party-unknown')
    assert.equal(plan([party], [])[0].status, 'party-unknown')
    const targeted = effect({ id: 'target', kind: 'targeted-buff', stackGroup: 'group' })
    assert.equal(plan([party, targeted], [member()])[0].status, 'available')
    assert.equal(plan([party, targeted], [])[0].status, 'missing')
  })

  it('retains distinct-player demand, slot competition and calculation limits for every catalog effect', () => {
    const two = effect({ requirement: 2 })
    assert.equal(plan([two], [member(), member()])[0].status, 'missing')
    assert.equal(plan([two], [member(), member('two')])[0].status, 'available')
    const effects = [effect({ id: 'first', slot: 'shared' }), effect({ id: 'second', slot: 'shared' })]
    const single = plan(effects, [member()])
    assert.deepEqual(single.map((row) => row.status), ['contested', 'contested'])
    assert.equal(single[0].conflict?.shortfall, 1)
    assert.deepEqual(plan(effects, [member(), member('two')]).map((row) => row.status), ['available', 'available'])
    const limited = calculateCoverage(effects, [member()], { nodeLimit: 0 })
    assert.deepEqual(limited.requirements.map((row) => row.planning.status), ['indeterminate', 'indeterminate'])
    assert.equal(limited.planningSummary.indeterminate, 2)
    const invalid = calculateCoverage([effect({ kind: 'party-buff', slot: 'invalid' })], [member()])
    assert.ok(invalid.catalogErrors.length)
    assert.deepEqual(invalid.requirements, [])
    assert.equal(summaryText(invalid), 'Catalog error (1)')
  })

  it('keeps all three armor requirements independent and every other standard outcome unchanged', () => {
    const roster = [member(), { ...member('two'), className: 'Warlock', specialization: 'Affliction' }, { ...member('three'), className: 'Rogue', specialization: 'Combat' }]
    const report = calculateCoverage(standardEffects(coverageEffects), roster)
    assert.equal(report.requirements.length, 25)
    for (const key of ['armor-reduction', 'faerie-fire', 'curse-of-recklessness']) assert.equal(report.requirements.find((row) => row.key === key)?.planning.status, 'available')
    // The current standard catalog has no requirement whose research-only alternatives change this roster's outcome.
    assert.deepEqual(report.requirements.map((row) => row.planning.status), report.requirements.map((row) => row.estimate.status))
    const tiles = coverageTiles(coverageEffects, roster)
    assert.equal(statusCounts(tiles).reduce((sum, count) => sum + count.count, 0), 25)
    assert.deepEqual(tiles.map((tile) => tile.status), report.requirements.map((row) => row.planning.status))
    const priest = { ...member(), className: 'Priest', specialization: 'Holy' }
    const inspiration = calculateCoverage(coverageEffects.filter((entry) => entry.id === 'dark-inspiration'), [priest]).requirements[0]
    assert.equal(inspiration.estimate.status, 'unverified')
    assert.equal(inspiration.planning.status, 'potential', 'Accepted Dark Inspiration still requires an untracked talent')
  })

  it('exposes operational status and provider details without research warnings in labels or tooltip text', () => {
    const entries = [effect(), effect({ id: 'talent', providers: [{ className: 'Druid', talent: 'Test talent' }] }), effect({ id: 'party', kind: 'party-buff' })]
    const tiles = coverageTiles(entries, [member()])
    for (const tile of tiles) {
      const visible = JSON.stringify({ label: tile.label, statusLabel: tile.statusLabel, lines: tile.lines, tooltip: tile.tooltip })
      assert.doesNotMatch(visible, /Est\.|Estimated|Estimate:|provisional|unverified|verif(?:ied|ication).*game|Internal research/i)
      assert.match(tile.lines.join(' '), /Eligible providers: Druid/)
    }
    assert.match(tiles[0].lines[0], /roster coverage, not whether the spell is active/)
    assert.match(tiles[1].lines.join(' '), /talent/)
    assert.match(tiles[2].lines[0], /Party groups are not tracked/)
  })
})
