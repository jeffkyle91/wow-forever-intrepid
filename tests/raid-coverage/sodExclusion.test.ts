import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage, validateEffects } from '../../src/shared/raid-coverage/calculateCoverage.ts'
import { coverageEffects } from '../../src/shared/raid-coverage/coverageData.ts'
import { coverageTiles, inactiveEffects, standardEffects, statusCounts } from '../../src/shared/raid-coverage/coverageDisplay.ts'
import { spellInfo } from '../../src/shared/raid-coverage/spellDescriptions.ts'
import { iconName } from '../../src/shared/raid-coverage/spellIcons.ts'
import type { CoverageEffect, CoverageMember } from '../../src/shared/raid-coverage/types.ts'

const member = (id: string, className: string, specialization = ''): CoverageMember => ({ id, name: `Player ${id}`, className, specialization })

// Suspected Season of Discovery only: no Forever-specific evidence they exist, so inactive research, never counted.
const inactiveIds = ['horn-of-lordaeron', 'wild-strikes', 'homunculi', 'vampiric-touch']
const inactiveNames = ['Horn of Lordaeron', 'Wild Strikes', 'Homunculi', 'Vampiric Touch']
// Spell IDs in the Season of Discovery range that are kept in the standard checklist because Forever has its own ranks for them.
const knownForeverIds = new Set([440892])
const allRoster = ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage', 'Warlock', 'Druid'].map((className, index) => member(String(index), className))

describe('Season of Discovery effects', () => {
  it('keeps them as inactive, unverified research with a stated reason and a Forever spell page', () => {
    assert.deepEqual(inactiveEffects(coverageEffects).map((entry) => entry.id).sort(), [...inactiveIds].sort())
    for (const entry of inactiveEffects(coverageEffects)) {
      assert.equal(entry.confidence, 'unverified', entry.id)
      assert.equal(entry.scopeStatus, 'unknown', entry.id)
      assert.match(entry.notes ?? '', /INACTIVE \(suspected Season of Discovery only/, entry.id)
      assert.ok(entry.sources.includes(`https://www.wowhead.com/forever/spell=${entry.spellId}`), entry.id)
      assert.ok(iconName(entry.spellId) && spellInfo[entry.spellId!], entry.id)
    }
    assert.deepEqual(validateEffects(coverageEffects), [])
  })

  it('removes them from the standard effects, tiles and counts for every roster', () => {
    const standardIds = standardEffects(coverageEffects).map((entry) => entry.id)
    for (const id of inactiveIds) assert.ok(!standardIds.includes(id), id)
    const tiles = coverageTiles(coverageEffects, allRoster)
    assert.equal(statusCounts(tiles).reduce((sum, entry) => sum + entry.count, 0), tiles.length)
    const text = JSON.stringify(tiles.map(({ tooltip, lines, name, alternatives, spellName, label, team }) => ({ tooltip, lines, name, alternatives, spellName, label, team })))
    for (const name of inactiveNames) assert.ok(!text.includes(name), name)
  })

  it('gives no provider credit for them: the class alone does not satisfy or soften a requirement', () => {
    const status = (key: string, roster: CoverageMember[]) => coverageTiles(coverageEffects, roster).find((tile) => tile.key === key)!.status
    assert.equal(status('extra-melee-attacks', [member('1', 'Druid', 'Feral')]), 'missing')
    assert.equal(status('attack-speed-reduction', [member('1', 'Priest', 'Shadow')]), 'missing')
    assert.equal(status('mana-regeneration', [member('1', 'Priest', 'Shadow')]), 'missing')
    const might = coverageTiles(coverageEffects, [member('1', 'Paladin')]).find((tile) => tile.key === 'melee-attack-power')!
    assert.equal(might.name, 'Blessing of Might')
    assert.deepEqual(might.alternatives, [])
    assert.equal(might.status, 'available')
  })

  it('does not count an inactive effect even when the roster matches it exactly', () => {
    for (const id of inactiveIds) {
      const entry = coverageEffects.find((candidate) => candidate.id === id)!
      const roster = allRoster.filter((player) => entry.providers.some((provider) => provider.className === player.className))
      assert.ok(roster.length > 0, id)
      assert.deepEqual(calculateCoverage(standardEffects([entry]), roster).requirements, [], id)
    }
  })

  it('guards the standard checklist: no standard effect has a Season of Discovery range ID or a rune provider', () => {
    for (const entry of standardEffects(coverageEffects)) {
      assert.ok(!(entry.spellId! >= 400000 && entry.spellId! < 1000000) || knownForeverIds.has(entry.spellId!), `${entry.id} (${entry.spellId}) looks like a Season of Discovery spell`)
      for (const provider of entry.providers) assert.doesNotMatch(provider.talent ?? '', /^Rune/i, entry.id)
    }
  })

  it('also keeps the owner-excluded SoD-era effects out of the checklist', () => {
    const excluded: CoverageEffect['visibility'][] = ['excluded', 'inactive']
    for (const id of ['heart-of-the-lion', 'valor-of-azeroth']) assert.ok(excluded.includes(coverageEffects.find((entry) => entry.id === id)!.visibility), id)
  })
})
