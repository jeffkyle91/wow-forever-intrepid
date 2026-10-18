import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage, validateEffects } from '../../src/shared/raid-coverage/calculateCoverage.ts'
import { coverageEffects } from '../../src/shared/raid-coverage/coverageData.ts'
import { coverageTiles } from '../../src/shared/raid-coverage/coverageDisplay.ts'
import type { CoverageEffect, CoverageMember } from '../../src/shared/raid-coverage/types.ts'

const classes = ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage', 'Warlock', 'Druid']
const member = (id: string, className: string): CoverageMember => ({ id, name: `Player ${id}`, className, specialization: '' })
const fullRaid = (): CoverageMember[] => Array.from({ length: 40 }, (_, i) => member(String(i), classes[i % classes.length]))
// What the checklist would show if an owner confirmed every entry in game. Used only to test provider matching.
const pretendConfirmed = (): CoverageEffect[] => coverageEffects.map((entry) => ({ ...entry, confidence: 'confirmed', scopeStatus: 'confirmed', verifiedOn: '2026-01-01' }))
const providersOf = (report: ReturnType<typeof calculateCoverage>, key: string) =>
  [...new Set(report.requirements.find((requirement) => requirement.key === key)?.effects.flatMap((entry) => entry.providers.map((provider) => provider.className)))].sort()

describe('real catalog', () => {
  it('passes validation', () => {
    assert.deepEqual(validateEffects(coverageEffects), [])
    assert.deepEqual(calculateCoverage(coverageEffects, fullRaid()).catalogErrors, [])
  })

  it('claims nothing as confirmed: no confirmed entries and no verification dates', () => {
    for (const entry of coverageEffects) {
      assert.notEqual(entry.confidence, 'confirmed', entry.id)
      assert.notEqual(entry.scopeStatus, 'confirmed', entry.id)
      assert.equal(entry.verifiedOn, undefined, entry.id)
    }
  })

  it('has no slots, because Forever exclusivity rules are unresolved', () => {
    assert.deepEqual(coverageEffects.filter((entry) => entry.slot !== undefined).map((entry) => entry.id), [])
  })

  it('cites only Wowhead Forever pages, with a spell ID on every entry', () => {
    for (const entry of coverageEffects) {
      assert.ok(entry.spellId && entry.spellId > 0, `${entry.id} needs a spellId`)
      assert.ok(entry.sources.length > 0, entry.id)
      for (const source of entry.sources) assert.match(source, /^https:\/\/www\.wowhead\.com\/forever\//, `${entry.id}: ${source}`)
      assert.ok(entry.sources.includes(`https://www.wowhead.com/forever/spell=${entry.spellId}`) || entry.id === 'salvation', `${entry.id} should cite its own spell page`)
      assert.ok(entry.notes, `${entry.id} needs notes`)
    }
  })

  it('has the expected size and verification split', () => {
    const report = calculateCoverage(coverageEffects, [])
    assert.equal(coverageEffects.length, 58)
    assert.equal(report.requirements.length, 33)
    assert.equal(coverageEffects.filter((entry) => entry.confidence ===     'provisional').length, 43)
        assert.equal(coverageEffects.filter((entry) => entry.confidence === 'unverified').length, 15)
  })

  it('keeps the verified result Unverified for any roster, and only ever estimates from provisional data', () => {
    for (const members of [[], [member('1', 'Warrior')], fullRaid(), classes.map((className, i) => member(String(i), className))]) {
      const report = calculateCoverage(coverageEffects, members)
      assert.equal(report.summary.unverified, report.requirements.length)
      assert.equal(report.confirmedCount, 0)
      assert.equal(report.hasIndeterminate, false)
      for (const requirement of report.requirements) {
        assert.equal(requirement.status, 'unverified', requirement.key)
        assert.notEqual(requirement.basis, 'verified', requirement.key)
        assert.notEqual(requirement.estimate.status, 'indeterminate', requirement.key)
      }
      for (const tile of coverageTiles(coverageEffects, members)) assert.notEqual(tile.basis, 'verified', tile.name)
    }
  })

  it('never estimates coverage for a requirement made only of unverified effects', () => {
    const report = calculateCoverage(coverageEffects, fullRaid())
    for (const requirement of report.requirements) {
      if (requirement.effects.every((entry) => entry.confidence === 'unverified')) {
        assert.equal(requirement.basis, 'unverified', requirement.key)
        assert.equal(requirement.estimate.status, 'unverified', requirement.key)
      }
    }
  })

  it('uses real spell names rather than preview names', () => {
    for (const entry of coverageEffects) assert.doesNotMatch(entry.name, /preview/i)
    const names = new Set(coverageEffects.map((entry) => entry.name))
    for (const name of ['Battle Shout', 'Blessing of Kings', 'Windfury Totem', 'Curse of the Elements', 'Faerie Fire', "Hunter's Mark"]) assert.ok(names.has(name), name)
  })

  it('lists every class as a provider somewhere', () => {
    const used = new Set(coverageEffects.flatMap((entry) => entry.providers.map((provider) => provider.className)))
    assert.deepEqual([...used].sort(), [...classes].sort())
  })

  it('keeps alternative providers together in one requirement', () => {
    const report = calculateCoverage(coverageEffects, [])
    assert.deepEqual(providersOf(report, 'armor-reduction'), ['Druid', 'Rogue', 'Warlock', 'Warrior'])
    assert.deepEqual(providersOf(report, 'melee-attack-power-reduction'), ['Druid', 'Priest', 'Warlock', 'Warrior'])
    assert.deepEqual(providersOf(report, 'extra-melee-attacks'), ['Druid', 'Shaman'])
    assert.deepEqual(providersOf(report, 'melee-attack-power'), ['Paladin'])
    assert.deepEqual(providersOf(report, 'stamina'), ['Priest'])
    assert.deepEqual(providersOf(report, 'shadow-resistance'), ['Paladin', 'Priest'])
  })

  it('does not copy the Classic Moonkin and Leader of the Pack exclusivity', () => {
    const keys = calculateCoverage(coverageEffects, []).requirements.map((requirement) => requirement.key)
    assert.ok(keys.includes('moonkin-form') && keys.includes('leader-of-the-pack'))
  })

  it('marks effects that need a talent or rune on the provider', () => {
    const talented = new Set(coverageEffects.filter((entry) => entry.providers.some((provider) => provider.talent)).map((entry) => entry.id))
    for (const id of ['trueshot-aura', 'leader-of-the-pack', 'moonkin-form', 'wild-strikes', 'homunculi', 'mana-tide-totem']) assert.ok(talented.has(id), id)
    assert.ok(!talented.has('battle-shout'))
  })
})

describe('real catalog, if every entry were later confirmed (provider matching only)', () => {
  it('reports a Warrior-only team as providing Battle Shout and Sunder Armor but not Blessing of Kings', () => {
    const out = Object.fromEntries(calculateCoverage(pretendConfirmed(), [member('1', 'Warrior')]).requirements.map((r) => [r.key, r.status]))
    assert.equal(out['battle-shout'], 'available')
    assert.equal(out['armor-reduction'], 'available')
    assert.equal(out['blessing-of-kings'], 'missing')
    assert.equal(out['curse-of-the-elements'], 'missing')
  })

  it('treats talent providers as Potential, never Available', () => {
    const druid = Object.fromEntries(calculateCoverage(pretendConfirmed(), [member('1', 'Druid')]).requirements.map((r) => [r.key, r.status]))
    assert.equal(druid['leader-of-the-pack'], 'potential')
    assert.equal(druid['moonkin-form'], 'potential')
    assert.equal(druid['mark-of-the-wild'], 'available')
    assert.equal(druid['armor-reduction'], 'available')
    assert.equal(druid['extra-melee-attacks'], 'potential')
    const hunter = Object.fromEntries(calculateCoverage(pretendConfirmed(), [member('1', 'Hunter')]).requirements.map((r) => [r.key, r.status]))
    assert.equal(hunter['trueshot-aura'], 'potential')
    assert.equal(hunter['hunters-mark'], 'available')
  })

  it('keeps party-wide effects Party Unknown and never invents a conflict', () => {
    const report = calculateCoverage(pretendConfirmed(), [member('1', 'Paladin'), member('2', 'Shaman')])
    const out = Object.fromEntries(report.requirements.map((r) => [r.key, r.status]))
    assert.equal(out['devotion-aura'], 'party-unknown')
    assert.equal(out['heart-of-the-lion'], 'party-unknown')
    assert.equal(report.summary.contested, 0)
    assert.equal(report.summary.indeterminate, 0)
  })

  it('every class team gets at least one non-Missing requirement, so no provider class is mismatched', () => {
    for (const className of classes) {
      const report = calculateCoverage(pretendConfirmed(), [member('1', className)])
      assert.ok(report.requirements.some((r) => ['available', 'potential', 'party-unknown'].includes(r.status)), className)
    }
  })
})
