import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage } from '../../src/shared/raid-coverage/calculateCoverage.ts'
import { coverageEffects } from '../../src/shared/raid-coverage/coverageData.ts'
import { coverageTiles, standardEffects } from '../../src/shared/raid-coverage/coverageDisplay.ts'
import { spellInfo } from '../../src/shared/raid-coverage/spellDescriptions.ts'
import type { CoverageEffect, CoverageMember } from '../../src/shared/raid-coverage/types.ts'

// Party size audit. Rosters are invented; only the first `providers` players are Alpha, the rest Beta.
const sizes = [5, 10, 20, 40]
const roster = (size: number, providers = 1): CoverageMember[] => Array.from({ length: size }, (_, index) => ({ id: String(index), name: `P${index}`, className: index < providers ? 'Alpha' : 'Beta', specialization: '' }))
const effect = (kind: CoverageEffect['kind']): CoverageEffect => ({ id: 'e', name: 'e', kind, providers: [{ className: 'Alpha' }], confidence: 'confirmed', scopeStatus: 'confirmed', sources: ['test'], verifiedOn: '2026-01-01' })
const statusOf = (kind: CoverageEffect['kind'], size: number, providers = 1) => calculateCoverage([effect(kind)], roster(size, providers)).requirements[0].status

describe('party-wide effects at 5, 10, 20 and 40 players', () => {
  it('never reports a party-wide effect as covered, however many players or providers there are', () => {
    for (const size of sizes) {
      for (const providers of [1, Math.ceil(size / 5), size]) assert.equal(statusOf('party-buff', size, providers), 'party-unknown', `${size} players, ${providers} providers`)
      assert.equal(statusOf('party-buff', size, 0), 'party-unknown', `${size} players, no provider`)
    }
  })

  it('does not treat a 10-player group as one party: a party-wide provider is not Available for it', () => {
    const tile = coverageTiles([effect('party-buff')], roster(10))[0]
    assert.equal(tile.status, 'party-unknown')
    assert.equal(tile.visual, 'uncertain')
  })

  it('calculates raid-wide, targeted and debuff effects the same way at every size: one eligible provider is enough', () => {
    for (const size of sizes) for (const kind of ['raid-buff', 'targeted-buff', 'debuff'] as const) assert.equal(statusOf(kind, size), 'available', `${kind} at ${size}`)
  })

  it('reports Missing for a raid-wide effect with no provider at any size', () => {
    for (const size of sizes) assert.equal(statusOf('raid-buff', size, 0), 'missing')
  })
})

describe('current catalog scopes', () => {
  const standard = standardEffects(coverageEffects)
  const byId = (id: string) => standard.find((entry) => entry.id === id)!

  it('keeps effects whose Forever text says "party or raid" raid-wide: Windfury, Trueshot Aura and the other totems and auras', () => {
    for (const id of ['windfury-totem', 'flametongue-totem', 'strength-of-earth-totem', 'grace-of-air-totem', 'trueshot-aura', 'leader-of-the-pack', 'moonkin-form', 'battle-shout']) {
      assert.equal(byId(id).kind, 'raid-buff', id)
      assert.match(spellInfo[byId(id).spellId!].description ?? '', /party or raid|party and raid/, id)
    }
  })

  it('has exactly the party-only totems as party-wide effects, each with "group members" in its Forever text', () => {
    assert.deepEqual(standard.filter((entry) => entry.kind === 'party-buff').map((entry) => entry.id), ['mana-spring-totem', 'mana-tide-totem'])
    for (const id of ['mana-spring-totem', 'mana-tide-totem']) assert.match(spellInfo[byId(id).spellId!].description ?? '', /group members/, id)
  })

  it('shows Windfury Totem and Trueshot Aura identically for 5, 10, 20 and 40 players', () => {
    for (const size of sizes) {
      const members: CoverageMember[] = Array.from({ length: size }, (_, index) => ({ id: String(index), name: `P${index}`, className: index === 0 ? 'Shaman' : index === 1 ? 'Hunter' : 'Mage', specialization: index === 1 ? 'Marksmanship' : '' }))
      const tiles = coverageTiles(coverageEffects, members)
      assert.equal(tiles.find((tile) => tile.key === 'extra-melee-attacks')!.status, 'available', `windfury ${size}`)
      assert.equal(tiles.find((tile) => tile.key === 'trueshot-aura')!.status, 'potential', `trueshot ${size}`)
    }
  })

  it('lets a Paladin (Blessing of Wisdom) satisfy mana regeneration while a Shaman alone stays Party Unknown', () => {
    const status = (className: string) => coverageTiles(coverageEffects, [{ id: '1', name: 'P', className, specialization: '' }, ...roster(9, 0).map((member, index) => ({ ...member, id: `x${index}` }))]).find((tile) => tile.key === 'mana-regeneration')!.status
    assert.equal(status('Paladin'), 'available')
    assert.equal(status('Shaman'), 'party-unknown')
    assert.equal(status('Mage'), 'missing')
  })

  // Mana Spring Totem's Forever text is "group members" (party only), so one Shaman never covers a 10, 20 or 40 player group.
  it('reports mana regeneration as Party Unknown, not Available, from only a party-wide Mana Spring Totem', () => {
    for (const size of sizes) {
      const members: CoverageMember[] = Array.from({ length: size }, (_, index) => ({ id: String(index), name: `P${index}`, className: index === 0 ? 'Shaman' : 'Mage', specialization: '' }))
      assert.equal(coverageTiles(coverageEffects, members).find((tile) => tile.key === 'mana-regeneration')!.status, 'party-unknown', `${size} players`)
    }
  })
})
