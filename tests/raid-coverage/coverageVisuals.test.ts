import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { calculateCoverage, validateEffects } from '../../src/features/raid-coverage/calculateCoverage.ts'
import { consumableAlternatives } from '../../src/features/raid-coverage/consumableData.ts'
import { bestPlanned, parsePlans, plannableFor, plannedIds, togglePlan, validateConsumables } from '../../src/features/raid-coverage/consumables.ts'
import { coverageEffects } from '../../src/features/raid-coverage/coverageData.ts'
import { coverageTiles, representativeEffect, statusGlyphs, visualOf, visualTreatments } from '../../src/features/raid-coverage/coverageDisplay.ts'
import { activeProviders } from '../../src/features/raid-coverage/coverageTooltip.ts'
import { spellInfo } from '../../src/features/raid-coverage/spellDescriptions.ts'
import type { ConsumableAlternative, CoverageEffect, CoverageMember } from '../../src/features/raid-coverage/types.ts'

// Invented effects and players: these test the mapping, not the game.
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
const real = (id: string) => coverageEffects.find((entry) => entry.id === id)!
const tileOf = (tiles: ReturnType<typeof coverageTiles>, key: string) => tiles.find((tile) => tile.key === key)!

// An invented consumable for the mechanism tests only. The real catalog has none.
const testDrum: ConsumableAlternative = {
  id: 'test-drum', name: 'Test Drum', requirementKey: 'm', effect: 'Invented effect text.', limitation: 'Invented: shorter and weaker.',
  confidence: 'provisional', sources: ['test'],
}

describe('icon visual state', () => {
  it('draws a covered icon untouched and a missing icon dark', () => {
    assert.equal(visualTreatments.covered.filter, 'none')
    assert.equal(visualTreatments.covered.opacity, 1)
    assert.match(visualTreatments.missing.filter, /grayscale\(0\.[5-9]\d*|grayscale\(1\)/)
    assert.match(visualTreatments.missing.filter, /brightness\(0\.[1-6]/)
    assert.ok(visualTreatments.missing.opacity < 1)
  })

  it('makes the four visuals distinct from each other', () => {
    const drawn = Object.values(visualTreatments).map((treatment) => `${treatment.filter}|${treatment.opacity}`)
    assert.equal(new Set(drawn).size, 4)
    assert.ok(visualTreatments.uncertain.filter.includes('brightness(0.8'))
    assert.ok(visualTreatments.consumable.filter.includes('sepia'))
  })

  it('maps status to visual: only Available is covered, and unresolved states are never covered', () => {
    assert.equal(visualOf('available'), 'covered')
    assert.equal(visualOf('missing'), 'missing')
    for (const status of ['potential', 'contested', 'unverified', 'party-unknown', 'indeterminate'] as const) assert.equal(visualOf(status), 'uncertain', status)
  })

  it('gives tiles the visual of their status and keeps the status glyph and label for non-colour cues', () => {
    const effects = [
      effect({ id: 'a', kind: 'raid-buff' }),
      effect({ id: 'm', kind: 'debuff', providers: [{ className: 'Beta' }] }),
      effect({ id: 'p', kind: 'raid-buff', providers: [{ className: 'Alpha', talent: 'T' }] }),
      effect({ id: 'u', kind: 'raid-buff', confidence: 'unverified' }),
      effect({ id: 'q', kind: 'party-buff' }),
      effect({ id: 'c1', kind: 'raid-buff', slot: 's' }),
      effect({ id: 'c2', kind: 'raid-buff', slot: 's' }),
    ]
    const tiles = coverageTiles(effects, [member('1', 'Alpha')])
    assert.deepEqual(tiles.map((tile) => [tile.key, tile.visual]), [['a', 'covered'], ['m', 'missing'], ['p', 'uncertain'], ['u', 'uncertain'], ['q', 'uncertain'], ['c1', 'uncertain'], ['c2', 'uncertain']])
    for (const tile of tiles) {
      assert.equal(tile.glyph, statusGlyphs[tile.status])
      assert.ok(tile.label.endsWith(tile.statusLabel), tile.key)
    }
  })

  it('does not draw an estimate as a verified result: the tile stays labelled Estimated', () => {
    const [tile] = coverageTiles([effect({ id: 'e', kind: 'raid-buff', confidence: 'provisional', scopeStatus: 'provisional' })], [member('1', 'Alpha')])
    assert.equal(tile.visual, 'covered')
    assert.equal(tile.estimated, true)
    assert.equal(tile.label, 'e: Estimated Available')
  })

  it('has CSS for the missing red tint and the consumable gold, in both themes', () => {
    const css = readFileSync(new URL('../../src/features/raid-coverage/RaidCoveragePanel.css', import.meta.url), 'utf8')
    assert.match(css, /\.cov-icon-visual-missing::after[^}]*rgba\(179, 38, 30/)
    assert.match(css, /\.cov-icon-visual-consumable \{[^}]*border-color/)
    assert.match(css, /data-theme='dark'\] \.cov-icon-visual-consumable/)
  })
})

describe('active provider selection', () => {
  const group = [
    effect({ id: 'a', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Alpha' }], confidence: 'provisional', scopeStatus: 'provisional' }),
    effect({ id: 'b', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Beta' }] }),
    effect({ id: 'c', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Gamma', talent: 'T', specs: ['X'], assumed: { specs: ['X'], basis: 'test' } }] }),
  ]
  const members = [member('1', 'Alpha'), member('2', 'Beta'), member('3', 'Gamma', 'X')]
  const requirement = (list: CoverageEffect[], roster: CoverageMember[]) => calculateCoverage(list, roster).requirements[0]

  it('prefers guaranteed over assumed, then confirmed over provisional, then catalog order', () => {
    assert.deepEqual(activeProviders(requirement(group, members)).map((entry) => entry.effect.id), ['b', 'a', 'c'])
    assert.deepEqual(activeProviders(requirement(group, [members[0], members[2]])).map((entry) => entry.effect.id), ['a', 'c'])
  })

  it('does not depend on roster or catalog order beyond the stated tie-break', () => {
    const forward = activeProviders(requirement(group, members)).map((entry) => entry.effect.id)
    assert.deepEqual(activeProviders(requirement(group, [...members].reverse())).map((entry) => entry.effect.id), forward)
  })

  it('lets a catalog `representative` flag win an otherwise equal tie', () => {
    const tied = [effect({ id: 'x', kind: 'raid-buff', stackGroup: 'g', spellId: 5242 }), effect({ id: 'y', kind: 'raid-buff', stackGroup: 'g', spellId: 1130, representative: true })]
    assert.equal(representativeEffect(tied).id, 'y')
    assert.equal(activeProviders(requirement(tied, [member('1', 'Alpha')]))[0].effect.id, 'y')
  })

  it('shows the satisfying spell, with its highest rank and local description, and names the other active providers', () => {
    const tiles = coverageTiles(coverageEffects, [member('1', 'Rogue', 'Combat'), member('2', 'Druid', 'Feral'), member('3', 'Warlock')])
    const armor = tileOf(tiles, 'armor-reduction')
    // Sunder Armor is the representative but no Warrior is present, so the first catalog provider that is present is shown.
    assert.equal(armor.status, 'available')
    assert.equal(armor.tooltip.state, 'covered')
    assert.equal(armor.tooltip.heading, 'Expose Armor')
    assert.equal(armor.spellName, 'Expose Armor')
    assert.equal(armor.tooltip.spells[0].rank, 'Rank 5')
    assert.equal(armor.tooltip.spells[0].description, spellInfo[8647].description)
    assert.equal(armor.tooltip.spells[0].iconUrl, armor.iconUrl)
    assert.ok(armor.tooltip.notes.includes('Also available: Faerie Fire, Curse of Recklessness'))
    assert.ok(armor.tooltip.notes.includes('Provided by: Combat Rogue'))
  })

  it('shows the highest-rank description of a single covering spell', () => {
    const windfury = tileOf(coverageTiles(coverageEffects, [member('1', 'Shaman')]), 'extra-melee-attacks')
    assert.equal(windfury.visual, 'covered')
    assert.equal(windfury.tooltip.spells[0].rank, 'Rank 3')
    assert.equal(windfury.tooltip.spells[0].description, spellInfo[8512].description)
    assert.match(windfury.tooltip.spells[0].description!, /246 extra melee attack power/)
  })
})

describe('missing and uncertain tooltips', () => {
  it('lists the spells and classes that could satisfy a missing requirement, with highest-rank descriptions', () => {
    const tile = tileOf(coverageTiles(coverageEffects, [member('1', 'Mage')]), 'armor-reduction')
    assert.equal(tile.visual, 'missing')
    assert.equal(tile.tooltip.state, 'missing')
    assert.deepEqual(tile.tooltip.spells.map((spell) => [spell.name, spell.providers]), [
      ['Sunder Armor', 'Warrior'], ['Expose Armor', 'Rogue'], ['Faerie Fire', 'Druid'], ['Curse of Recklessness', 'Warlock'],
    ])
    assert.equal(tile.tooltip.spells[0].description, spellInfo[7386].description)
    assert.equal(tile.tooltip.spells[0].rank, 'Rank 5')
  })

  it('does not offer an unverified alternative as coverage, and says it is not counted', () => {
    const tile = tileOf(coverageTiles(coverageEffects, [member('1', 'Mage', 'Fire')]), 'spirit')
    assert.deepEqual(tile.tooltip.spells.map((spell) => spell.name), ['Divine Spirit', 'Prayer of Spirit'])
    assert.ok(tile.tooltip.notes.some((note) => note.startsWith('Not counted (unverified): Dark Inspiration')))
  })

  it('names only the specializations a provider rule allows', () => {
    const tile = tileOf(coverageTiles(coverageEffects, [member('1', 'Hunter', 'Beast Mastery')]), 'trueshot-aura')
    assert.equal(tile.visual, 'missing')
    assert.deepEqual(tile.tooltip.spells.map((spell) => spell.providers), ['Hunter (Marksmanship; needs talent or rune)'])
    const moonkin = tileOf(coverageTiles(coverageEffects, [member('1', 'Druid', 'Restoration')]), 'moonkin-form')
    assert.deepEqual(moonkin.tooltip.spells.map((spell) => spell.providers), ['Druid (Balance; needs talent or rune; assumed for Balance)'])
    assert.equal(moonkin.status, 'missing')
    assert.ok(!moonkin.tooltip.spells.some((spell) => /Restoration/.test(spell.providers)))
  })

  it('explains why a potential or unresolved result is uncertain in one short note, not the full detail', () => {
    const potential = tileOf(coverageTiles(coverageEffects, [member('1', 'Hunter', 'Marksmanship')]), 'trueshot-aura')
    assert.equal(potential.status, 'potential')
    assert.equal(potential.tooltip.state, 'uncertain')
    assert.ok(potential.tooltip.notes.length <= 3)
    assert.ok(potential.tooltip.notes[0].includes('talent'))
    const unverified = coverageTiles([effect({ id: 'u', kind: 'raid-buff', confidence: 'unverified' })], [member('1', 'Alpha')])[0]
    assert.equal(unverified.tooltip.state, 'uncertain')
    assert.ok(unverified.tooltip.notes[0].startsWith('Not confirmed'))
  })

  it('caps a long list of possible spells', () => {
    const many = Array.from({ length: 6 }, (_, index) => effect({ id: `e${index}`, kind: 'debuff', stackGroup: 'g', providers: [{ className: 'Beta' }] }))
    const [tile] = coverageTiles(many, [member('1', 'Alpha')])
    assert.equal(tile.tooltip.spells.length, 4)
    assert.equal(tile.tooltip.hiddenSpells, 2)
  })

  it('never shows an excluded effect in any tooltip', () => {
    const tiles = coverageTiles(coverageEffects, [member('1', 'Shaman'), member('2', 'Paladin'), member('3', 'Priest'), member('4', 'Hunter'), member('5', 'Warrior')])
    const text = JSON.stringify(tiles.map((tile) => tile.tooltip))
    for (const name of ['Heart of the Lion', 'Valor of Azeroth', 'Tremor Totem', 'Stoneskin Totem', 'Devotion Aura', 'Fear Ward', 'Judgement', 'Seal of', 'Resistance']) assert.ok(!text.includes(name), name)
  })
})

describe('consumable alternatives', () => {
  const effects = [effect({ id: 'm', kind: 'raid-buff', providers: [{ className: 'Beta' }] })]
  const players = [member('1', 'Alpha')]

  it('ships no consumable entries: none is assumed without Forever evidence', () => {
    assert.deepEqual(consumableAlternatives, [])
    assert.deepEqual(validateConsumables(consumableAlternatives, coverageEffects), [])
  })

  it('offers an option but never marks it planned or supplied by itself', () => {
    const [tile] = coverageTiles(effects, players, { consumables: [testDrum] })
    assert.equal(tile.status, 'missing')
    assert.equal(tile.visual, 'missing')
    assert.equal(tile.consumable, undefined)
    assert.deepEqual(tile.consumableOptions.map((option) => option.id), ['test-drum'])
  })

  it('shows a planned consumable as muted gold while the class coverage result stays Missing', () => {
    const [tile] = coverageTiles(effects, players, { consumables: [testDrum], planned: new Set(['test-drum']) })
    assert.equal(tile.status, 'missing')
    assert.equal(tile.visual, 'consumable')
    assert.equal(tile.consumable?.id, 'test-drum')
    assert.equal(tile.tooltip.state, 'consumable')
    assert.equal(tile.tooltip.heading, 'Test Drum')
    assert.ok(tile.tooltip.notes.includes('Invented effect text.'))
    assert.ok(tile.tooltip.notes.some((note) => note.startsWith('Weaker or different')))
    assert.ok(tile.tooltip.notes.some((note) => note.includes('Missing')))
    assert.ok(tile.label.includes('Planned consumable: Test Drum'))
    assert.ok(tile.label.includes('Missing'))
  })

  it('does not change the status counts or the engine result', () => {
    const without = calculateCoverage(effects, players)
    const [tile] = coverageTiles(effects, players, { consumables: [testDrum], planned: new Set(['test-drum']) })
    assert.equal(tile.status, without.requirements[0].estimate.status)
  })

  it('ignores a planned consumable when class coverage already satisfies the requirement', () => {
    const [tile] = coverageTiles(effects, [member('1', 'Beta')], { consumables: [testDrum], planned: new Set(['test-drum']) })
    assert.equal(tile.visual, 'covered')
    assert.equal(tile.consumable, undefined)
  })

  it('cannot plan an unverified entry or one for another requirement', () => {
    const unverifiedDrum = { ...testDrum, id: 'u', confidence: 'unverified' as const }
    const elsewhere = { ...testDrum, id: 'z', requirementKey: 'other' }
    assert.deepEqual(plannableFor([unverifiedDrum, elsewhere], 'm'), [])
    assert.equal(bestPlanned([unverifiedDrum, elsewhere], 'm', new Set(['u', 'z'])), undefined)
    assert.deepEqual([...plannedIds({ t: ['u', 'test-drum', 'gone'] }, 't', [unverifiedDrum, testDrum])], ['test-drum'])
  })

  it('picks the first planned entry in catalog order as the best', () => {
    const weaker = { ...testDrum, id: 'weaker' }
    assert.equal(bestPlanned([testDrum, weaker], 'm', new Set(['weaker', 'test-drum']))?.id, 'test-drum')
  })

  it('validates catalog entries', () => {
    const problems = validateConsumables([{ ...testDrum, requirementKey: 'nope', sources: [], effect: ' ', limitation: '', verifiedOn: 'soon' }, { ...testDrum, confidence: 'confirmed' }, testDrum], effects).join('\n')
    assert.match(problems, /requirementKey "nope"/)
    assert.match(problems, /no source/)
    assert.match(problems, /effect text is required/)
    assert.match(problems, /limitation text is required/)
    assert.match(problems, /verifiedOn must be YYYY-MM-DD/)
    assert.match(problems, /confirmed entries need verifiedOn/)
    assert.match(problems, /Duplicate consumable id/)
  })

  it('stores plans per team on this device only, tolerating bad stored data', () => {
    assert.deepEqual(parsePlans(null), {})
    assert.deepEqual(parsePlans('not json'), {})
    assert.deepEqual(parsePlans('[1]'), {})
    assert.deepEqual(parsePlans('{"a":["x"],"b":"y","c":[1]}'), { a: ['x'] })
    const on = togglePlan({}, 'blue', 'test-drum', true)
    assert.deepEqual(on, { blue: ['test-drum'] })
    assert.deepEqual(togglePlan(on, 'yellow', 'test-drum', true), { blue: ['test-drum'], yellow: ['test-drum'] })
    assert.deepEqual(togglePlan(togglePlan(on, 'blue', 'test-drum', true), 'blue', 'test-drum', false), { blue: [] })
  })
})

describe('scope changes through catalog configuration', () => {
  const withKind = (id: string, kind: CoverageEffect['kind']) => coverageEffects.map((entry) => (entry.id === id ? { ...entry, kind } : entry))
  const windfury = (effects: CoverageEffect[]) => tileOf(coverageTiles(effects, [member('1', 'Shaman')]), 'extra-melee-attacks')

  it('treats Windfury Totem as raid-wide today', () => {
    assert.equal(real('windfury-totem').kind, 'raid-buff')
    assert.equal(windfury(coverageEffects).status, 'available')
  })

  it('turns it into a party buff by changing only the `kind` field, with no algorithm change', () => {
    const edited = withKind('windfury-totem', 'party-buff')
    assert.deepEqual(validateEffects(edited), [])
    assert.equal(windfury(edited).status, 'party-unknown')
    assert.equal(windfury(edited).visual, 'uncertain')
    assert.equal(calculateCoverage(edited, [member('1', 'Shaman')]).requirements.find((r) => r.key === 'extra-melee-attacks')!.kind, 'party-buff')
  })

  it('turns a party buff into a raid-wide one the same way', () => {
    const party = withKind('windfury-totem', 'party-buff')
    const back = party.map((entry) => (entry.id === 'windfury-totem' ? { ...entry, kind: 'raid-buff' as const } : entry))
    assert.equal(windfury(back).status, 'available')
    const flametongue = (effects: CoverageEffect[]) => tileOf(coverageTiles(effects, [member('1', 'Shaman')]), 'flametongue-totem').status
    assert.equal(flametongue(coverageEffects), 'available')
    assert.equal(flametongue(withKind('flametongue-totem', 'party-buff')), 'party-unknown')
  })

  it('reports the most cautious scope in a group and still refuses to mix a buff with a debuff', () => {
    const [raid, party] = [effect({ id: 'r', kind: 'raid-buff', stackGroup: 'g' }), effect({ id: 'p', kind: 'party-buff', stackGroup: 'g', providers: [{ className: 'Beta' }] })]
    assert.deepEqual(validateEffects([raid, party]), [])
    assert.equal(calculateCoverage([raid, party], [member('1', 'Alpha')]).requirements[0].kind, 'party-buff')
    assert.ok(validateEffects([raid, effect({ id: 'd', kind: 'debuff', stackGroup: 'g' })]).some((problem) => /mixes kinds/.test(problem)))
  })
})

describe('regressions', () => {
  it('keeps the real catalog valid and the standard checklist unchanged', () => {
    assert.deepEqual(validateEffects(coverageEffects), [])
    assert.equal(calculateCoverage(coverageEffects.filter((entry) => (entry.visibility ?? 'standard') === 'standard'), []).requirements.length, 23)
  })

  it('keeps slot conflicts as an unresolved (not covered) icon', () => {
    const tiles = coverageTiles([effect({ id: 'a', kind: 'raid-buff', slot: 's' }), effect({ id: 'b', kind: 'raid-buff', slot: 's' })], [member('1', 'Alpha')])
    assert.deepEqual(tiles.map((tile) => [tile.status, tile.visual]), [['contested', 'uncertain'], ['contested', 'uncertain']])
  })

  it('keeps an assumed Feral Druid as Estimated Available, drawn covered but labelled as an estimate', () => {
    const tile = tileOf(coverageTiles(coverageEffects, [member('1', 'Druid', 'Feral')]), 'leader-of-the-pack')
    assert.equal(tile.statusLabel, 'Estimated Available')
    assert.equal(tile.visual, 'covered')
    assert.ok(tile.tooltip.notes.includes('Estimate from provisional data; not verified in game.'))
  })
})

describe('per-provider scope inside one requirement', () => {
  // A raid-wide alternative (Alpha) and a party-wide alternative (Beta) for one requirement.
  const mixed = [
    effect({ id: 'wide', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Alpha' }] }),
    effect({ id: 'party', kind: 'party-buff', stackGroup: 'g', providers: [{ className: 'Beta' }] }),
  ]
  const statusOf = (roster: CoverageMember[], list = mixed) => calculateCoverage(list, roster).requirements[0]

  it('is Available when the raid-wide alternative has a provider, even though another alternative is party-wide', () => {
    for (const roster of [[member('1', 'Alpha')], [member('1', 'Alpha'), member('2', 'Beta')]]) {
      const requirement = statusOf(roster)
      assert.equal(requirement.status, 'available')
      assert.equal(requirement.estimate.status, 'available')
    }
  })

  it('is Party Unknown, never Available, when only the party-wide alternative has a provider', () => {
    const requirement = statusOf([member('1', 'Beta')])
    assert.equal(requirement.status, 'party-unknown')
    assert.equal(requirement.estimate.status, 'party-unknown')
    assert.equal(coverageTiles(mixed, [member('1', 'Beta')])[0].visual, 'uncertain')
  })

  it('is Missing, not Party Unknown, when nobody can provide either alternative', () => {
    assert.equal(statusOf([member('1', 'Gamma')]).status, 'missing')
  })

  it('keeps Potential when the raid-wide alternative needs an untracked talent and no party provider is present', () => {
    const talent = [effect({ id: 'wide', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Alpha', talent: 'T' }] }), mixed[1]]
    assert.equal(statusOf([member('1', 'Alpha')], talent).status, 'potential')
  })

  it('does not let a party-wide provider stand in for a slot-free player or demand', () => {
    const slotted = [effect({ id: 'wide', kind: 'raid-buff', stackGroup: 'g', slot: 's', providers: [{ className: 'Alpha' }] }), mixed[1], effect({ id: 'other', kind: 'raid-buff', slot: 's', providers: [{ className: 'Alpha' }] })]
    const report = calculateCoverage(slotted, [member('1', 'Alpha'), member('2', 'Beta')])
    assert.deepEqual(report.requirements.map((r) => r.status), ['contested', 'contested'])
  })

  it('shows the raid-wide provider as the covering spell, and the party-wide one is never the active provider', () => {
    const roster = [member('1', 'Alpha'), member('2', 'Beta')]
    const [tile] = coverageTiles([{ ...mixed[1], representative: true }, mixed[0]], roster)
    assert.equal(tile.status, 'available')
    assert.equal(tile.tooltip.heading, 'wide')
    assert.ok(!tile.tooltip.notes.some((note) => note.startsWith('Also available')))
  })

  it('applies the same per-provider rule to the real Windfury Totem group', () => {
    const edited = coverageEffects.map((entry) => (entry.id === 'windfury-totem' ? { ...entry, kind: 'party-buff' as const } : entry))
    const status = (roster: CoverageMember[]) => tileOf(coverageTiles(edited, roster), 'extra-melee-attacks').status
    assert.equal(status([member('1', 'Shaman')]), 'party-unknown')
    assert.equal(status([member('1', 'Shaman'), member('2', 'Druid')]), 'party-unknown')
    // Wild Strikes is inactive, so Windfury is the group's only active effect and it is party-wide.
    assert.equal(status([member('1', 'Mage')]), 'party-unknown')
  })
})
describe('mouseover tooltip rendering', () => {
  it('renders only the selected spell name and its stored description', () => {
    const source = readFileSync(new URL('../../src/features/raid-coverage/RaidCoverageStrip.tsx', import.meta.url), 'utf8')
    const tip = source.slice(source.indexOf('role="tooltip"'))
    assert.match(tip, /tip\.tile\.spellName/)
    assert.match(tip, /tip\.tile\.description/)
    assert.doesNotMatch(tip, /tooltip\.|statusLabel|\.lines|\.team|providerClasses|alternatives|basis|estimated|confidence/)
  })
})
