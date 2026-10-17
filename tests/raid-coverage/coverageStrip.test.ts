import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage, validateEffects } from '../../src/features/raid-coverage/calculateCoverage.ts'
import { coverageEffects } from '../../src/features/raid-coverage/coverageData.ts'
import { coverageTiles, DESCRIPTION_UNAVAILABLE, encounterEffects, representativeEffect, standardEffects, STRIP_DEFAULT_OPEN, statusCounts } from '../../src/features/raid-coverage/coverageDisplay.ts'
import { spellInfo } from '../../src/features/raid-coverage/spellDescriptions.ts'
import { iconName, iconUrl } from '../../src/features/raid-coverage/spellIcons.ts'
import type { CoverageEffect, CoverageMember } from '../../src/features/raid-coverage/types.ts'

const effect = (over: Partial<CoverageEffect> & Pick<CoverageEffect, 'id' | 'kind'>): CoverageEffect => ({
  name: over.id,
  providers: [{ className: 'Alpha' }],
  confidence: 'confirmed',
  scopeStatus: 'confirmed',
  sources: ['test'],
  verifiedOn: '2026-01-01',
  ...over,
})
const member = (id: string, className: string): CoverageMember => ({ id, name: `Player ${id}`, className, specialization: '' })

const resistanceIds = [
  'fire-resistance-totem', 'fire-resistance-aura', 'frost-resistance-totem', 'frost-resistance-aura', 'nature-resistance-totem',
  'aspect-of-the-wild', 'shadow-resistance-aura', 'prayer-of-shadow-protection', 'shadow-protection',
]

describe('visibility filtering', () => {
  it('treats a missing visibility as standard and hides encounter-specific effects from tiles', () => {
    const effects = [effect({ id: 'a', kind: 'raid-buff' }), effect({ id: 'b', kind: 'raid-buff', visibility: 'standard' }), effect({ id: 'c', kind: 'raid-buff', visibility: 'encounter' })]
    assert.deepEqual(standardEffects(effects).map((entry) => entry.id), ['a', 'b'])
    assert.deepEqual(encounterEffects(effects).map((entry) => entry.id), ['c'])
    assert.deepEqual(coverageTiles(effects, [member('1', 'Alpha')]).map((tile) => tile.key), ['a', 'b'])
  })

  it('does not change the other requirements when an encounter effect is added', () => {
    const base = [effect({ id: 'a', kind: 'raid-buff' }), effect({ id: 'm', kind: 'debuff', providers: [{ className: 'Beta' }] })]
    const members = [member('1', 'Alpha')]
    const withHidden = [...base, effect({ id: 'h', kind: 'raid-buff', visibility: 'encounter' })]
    assert.deepEqual(coverageTiles(withHidden, members), coverageTiles(base, members))
  })

  it('keeps a stack group whole: an encounter-specific effect cannot share a group with other visibilities', () => {
    const mixed = [effect({ id: 'a', kind: 'raid-buff', stackGroup: 'g' }), effect({ id: 'b', kind: 'raid-buff', stackGroup: 'g', visibility: 'encounter' })]
    assert.ok(validateEffects(mixed).some((problem) => problem.includes('mixes encounter-specific')))
    assert.deepEqual(validateEffects(mixed.map((entry) => ({ ...entry, visibility: 'encounter' as const }))), [])
  })

  it('hides excluded effects everywhere but lets them share a group with standard alternatives', () => {
    const effects = [
      effect({ id: 'a', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Alpha' }] }),
      effect({ id: 'x', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Beta' }], visibility: 'excluded' }),
      effect({ id: 'solo', kind: 'raid-buff', providers: [{ className: 'Beta' }], visibility: 'excluded' }),
    ]
    assert.deepEqual(validateEffects(effects), [])
    assert.deepEqual(standardEffects(effects).map((entry) => entry.id), ['a'])
    assert.deepEqual(encounterEffects(effects), [])
    const tiles = coverageTiles(effects, [member('1', 'Beta')])
    assert.deepEqual(tiles.map((tile) => [tile.key, tile.status]), [['g', 'missing']])
    assert.equal(tiles[0].name, 'a')
    assert.equal(tiles[0].alternatives.length, 0)
  })

  it('rejects an unknown visibility value', () => {
    const bad = [effect({ id: 'a', kind: 'raid-buff', visibility: 'hidden' as never })]
    assert.ok(validateEffects(bad).some((problem) => problem.includes('visibility must be')))
  })
})

describe('real catalog visibility', () => {
  const tiles = coverageTiles(coverageEffects, [member('1', 'Shaman'), member('2', 'Paladin'), member('3', 'Priest'), member('4', 'Hunter')])
  const tileNames = tiles.map((tile) => tile.name).join(' | ')

  it('keeps the resistance auras, totems, Aspect of the Wild and Priest Shadow Protection out of the standard checklist', () => {
    for (const name of ['Fire Resistance', 'Frost Resistance', 'Nature Resistance', 'Shadow Resistance', 'Aspect of the Wild', 'Shadow Protection']) {
      assert.ok(!tileNames.includes(name), `${name} should not be a standard tile`)
    }
    assert.ok(!tiles.some((tile) => ['fire-resistance', 'frost-resistance', 'nature-resistance', 'shadow-resistance'].includes(tile.key)))
  })

  it('still lists the nine researched effects in the catalog, marked encounter-specific, with their sources', () => {
    assert.deepEqual(encounterEffects(coverageEffects).map((entry) => entry.id).sort(), [...resistanceIds].sort())
    for (const entry of encounterEffects(coverageEffects)) {
      assert.ok(entry.spellId && entry.sources.length && entry.notes, entry.id)
      assert.notEqual(entry.confidence, 'confirmed')
    }
  })

  it('does not delete general-purpose buffs that also give resistance', () => {
    assert.ok(tileNames.includes('Mark of the Wild'))
    assert.ok(coverageEffects.some((entry) => entry.id === 'gift-of-the-wild' && entry.visibility !== 'encounter'))
  })

  it('shows 23 standard requirements and the full catalog still validates', () => {
    assert.equal(tiles.length, VISIBLE_REQUIREMENTS)
    assert.equal(standardEffects(coverageEffects).length, coverageEffects.length - 9 - excludedIds.length - 4)
    assert.equal(calculateCoverage(coverageEffects, []).requirements.length, 33)
    assert.deepEqual(validateEffects(coverageEffects), [])
  })
})

const excludedIds = ['heart-of-the-lion', 'valor-of-azeroth', 'tremor-totem', 'devotion-aura', 'judgement-of-wisdom', 'stoneskin-totem', 'fear-ward', 'judgement-of-light', 'windwall-totem']
const VISIBLE_REQUIREMENTS = 23

describe('excluded effects', () => {
  const members = [member('1', 'Shaman'), member('2', 'Paladin'), member('3', 'Priest'), member('4', 'Warrior')]
  const tiles = coverageTiles(coverageEffects, members)

  it('keeps the excluded effects in the catalog with their spell ID, URL, icon and description data', () => {
    assert.deepEqual(coverageEffects.filter((entry) => entry.visibility === 'excluded').map((entry) => entry.id).sort(), [...excludedIds].sort())
    for (const id of excludedIds) {
      const entry = coverageEffects.find((candidate) => candidate.id === id)!
      assert.ok(entry.spellId && entry.sources.some((source) => source.includes('wowhead.com/forever')), id)
      assert.ok(iconName(entry.spellId), id)
      assert.ok(spellInfo[entry.spellId!], id)
    }
  })

  it('drops them from the standard effects, the tiles, the counts and the encounter list', () => {
    const standardIds = standardEffects(coverageEffects).map((entry) => entry.id)
    for (const id of excludedIds) assert.ok(!standardIds.includes(id), id)
    assert.deepEqual(encounterEffects(coverageEffects).map((entry) => entry.id).sort(), [...resistanceIds].sort())
    const names = tiles.map((tile) => tile.spellName).join(' | ')
    for (const name of ['Heart of the Lion', 'Valor of Azeroth', 'Tremor Totem', 'Devotion Aura', 'Judgement', 'Seal of', 'Stoneskin Totem', 'Fear Ward']) assert.ok(!names.includes(name), name)
    assert.equal(statusCounts(tiles).reduce((sum, entry) => sum + entry.count, 0), VISIBLE_REQUIREMENTS)
    assert.equal(calculateCoverage(standardEffects(coverageEffects), members).requirements.length, VISIBLE_REQUIREMENTS)
  })

  it('leaves no requirement for the fear protection and judgement groups, whose effects are all excluded', () => {
    assert.ok(!tiles.some((tile) => tile.key === 'fear-protection' || tile.key === 'judgement'))
    const keys = calculateCoverage(standardEffects(coverageEffects), members).requirements.map((r) => r.key)
    assert.ok(!keys.includes('fear-protection') && !keys.includes('judgement'))
  })

  it('hides the whole physical damage reduction requirement once Stoneskin Totem and Windwall Totem are both excluded', () => {
    assert.ok(!tiles.some((tile) => tile.key === 'physical-damage-reduction'))
    assert.ok(!tiles.some((tile) => /Windwall|Stoneskin/.test(JSON.stringify([tile.tooltip, tile.lines, tile.label]))))
    assert.ok(!calculateCoverage(standardEffects(coverageEffects), [member('1', 'Shaman')]).requirements.some((r) => r.key === 'physical-damage-reduction'))
    const windwall = coverageEffects.find((entry) => entry.id === 'windwall-totem')!
    assert.equal(windwall.visibility, 'excluded')
    assert.equal(windwall.spellId, 15107)
  })

  it('does not count an excluded provider as coverage', () => {
    const report = calculateCoverage(standardEffects(coverageEffects), [member('1', 'Shaman'), member('2', 'Paladin'), member('3', 'Priest')])
    assert.ok(!report.requirements.some((r) => ['judgement', 'fear-protection'].includes(r.key)))
  })

  it('gives the same filtered checklist for 10, 20 and 40 player compositions', () => {
    for (const size of [10, 20, 40]) {
      const roster = Array.from({ length: size }, (_, index) => member(String(index), ['Warrior', 'Priest', 'Shaman', 'Paladin', 'Druid'][index % 5]))
      const sized = coverageTiles(coverageEffects, roster)
      assert.deepEqual(sized.map((tile) => tile.key), tiles.map((tile) => tile.key), String(size))
    }
  })
})

describe('tooltip descriptions', () => {
  const tiles = coverageTiles(coverageEffects, [member('1', 'Warrior')])

  it('uses the stored description of the icon\'s own spell, with its stored Wowhead name', () => {
    for (const tile of tiles) {
      const info = spellInfo[tile.spellId!]
      assert.ok(info, tile.key)
      assert.equal(tile.spellName, info.name, tile.key)
      assert.equal(tile.description, info.description ?? DESCRIPTION_UNAVAILABLE, tile.key)
      assert.equal(tile.descriptionAvailable, info.description !== undefined, tile.key)
    }
  })

  // Horn of Lordaeron and Vampiric Touch have no readable description, but each is an alternative in a group whose icon is another spell
  // (Battle Shout and the mana regeneration representative), so no visible icon needs the fallback today. The fallback is tested through
  // a requirement whose own icon is Horn of Lordaeron.
  it('shows "Highest-rank spell description unavailable" for an effect whose description could not be read', () => {
    assert.deepEqual(tiles.filter((tile) => !tile.descriptionAvailable).map((tile) => tile.spellName), [])
    const [tile] = coverageTiles([effect({ id: 'u', kind: 'raid-buff', spellId: 425600 })], [member('1', 'Alpha')])
    assert.equal(tile.descriptionAvailable, false)
    assert.equal(tile.description, 'Highest-rank spell description unavailable')
    assert.equal(tile.spellName, 'Horn of Lordaeron')
  })

  it('records a reason for every catalog spell without a description', () => {
    const missing = Object.entries(spellInfo).filter(([, info]) => info.description === undefined)
    assert.deepEqual(missing.map(([, info]) => info.name).sort(), ['Horn of Lordaeron', 'Valor of Azeroth', 'Vampiric Touch'])
    for (const [, info] of missing) assert.ok(info.reason)
  })

  it('has a name, a highest-rank spell ID and a Forever source URL for every catalog spell, with no stray formula text', () => {
    for (const entry of coverageEffects) {
      const info = spellInfo[entry.spellId!]
      assert.ok(info?.name, entry.id)
      assert.ok(info.tooltipSpellId, entry.id)
      assert.equal(info.sourceUrl, `https://www.wowhead.com/forever/spell=${info.tooltipSpellId}`, entry.id)
    }
    for (const info of Object.values(spellInfo)) if (info.description) assert.doesNotMatch(info.description, /Requires|Reagents|<|>|&nbsp;|\d\s*\*\s*\d|\d\s\/\s\d/, info.name)
  })


  it('does not put coverage, provider or confidence text in the tooltip fields', () => {
    for (const tile of tiles) assert.doesNotMatch(`${tile.spellName} ${tile.description}`, /Estimate|Eligible providers|Unverified|Guaranteed in this team/)
  })

  it('uses the displayed alternative\'s description, not a combined one', () => {
    const armor = tiles.find((tile) => tile.name.includes('Sunder Armor'))!
    assert.equal(armor.description, spellInfo[armor.spellId!].description)
    assert.ok(armor.alternatives.length >= 2)
    assert.ok(!armor.description.includes('Faerie Fire'))
  })

  it('names the spell and the status in the accessible label', () => {
    for (const tile of tiles) assert.equal(tile.label, `${tile.spellName}: ${tile.statusLabel}`)
  })
})

describe('highest-rank tooltips', () => {
  const byCatalogId = (id: string) => spellInfo[coverageEffects.find((entry) => entry.id === id)!.spellId!]
  const tiles = coverageTiles(coverageEffects, [member('1', 'Warrior')])

  it('uses the highest-numbered rank, not the highest spell ID or the catalog\'s primary rank', () => {
    // [catalog id, highest rank's spell ID, rank]. Mark of the Wild shows why the ID order is not the rank order: Rank 3 is 6756, Rank 4 is 5234.
    const expected: [string, number, string][] = [
      ['battle-shout', 25289, 'Rank 7'],
      ['blessing-of-might', 25291, 'Rank 7'],
      ['mark-of-the-wild', 9885, 'Rank 7'],
      ['power-word-fortitude', 10938, 'Rank 6'],
      ['prayer-of-fortitude', 21564, 'Rank 2'],
      ['sunder-armor', 11597, 'Rank 5'],
      ['thunder-clap', 11581, 'Rank 6'],
      ['curse-of-the-elements', 1311680, 'Rank 4'],
      ['hunters-mark', 14325, 'Rank 4'],
      ['windwall-totem', 15112, 'Rank 3'],
    ]
    for (const [id, spellId, rank] of expected) {
      const info = byCatalogId(id)
      assert.equal(info.tooltipSpellId, spellId, id)
      assert.equal(info.rank, rank, id)
      assert.equal(info.sourceUrl, `https://www.wowhead.com/forever/spell=${spellId}`, id)
    }
  })

  const byName = (name: string) => tiles.find((tile) => tile.spellName === name)!

  it('shows the maximum-rank numbers in the tile, not the lower catalog rank', () => {
    assert.match(byName('Battle Shout').description, /by 140\. Lasts 3 min\.$/)
    assert.doesNotMatch(byName('Battle Shout').description, /by 24\b/)
    assert.match(byName('Mark of the Wild').description, /armor by 385, all attributes by 16/)
    assert.match(byName('Curse of the Elements').description, /by 75 and increasing Magic damage taken by 10%/)
    assert.match(byName('Blessing of Might').description, /melee attack power by 133/)
  })

  it('shows the description of the displayed alternative\'s own highest rank', () => {
    const armor = tiles.find((tile) => tile.name.includes('Sunder Armor'))!
    assert.equal(armor.spellId, 7386)
    assert.equal(armor.description, byCatalogId('sunder-armor').description)
    assert.match(armor.description, /reducing it by 450 per Sunder Armor/)
  })

  it('stores an unranked spell under its own ID with no rank', () => {
    for (const id of ['leader-of-the-pack', 'moonkin-form', 'wild-strikes', 'blessing-of-kings', 'salvation', 'homunculi']) {
      const entry = coverageEffects.find((candidate) => candidate.id === id)!
      const info = spellInfo[entry.spellId!]
      assert.equal(info.tooltipSpellId, entry.spellId, id)
      assert.equal(info.rank, undefined, id)
      assert.ok(info.description, id)
    }
    assert.match(byName('Leader of the Pack').description, /by 3%\.$/)
  })

  it('keeps a spell with a single rank at Rank 1', () => {
    assert.equal(byCatalogId('trueshot-aura').rank, 'Rank 1')
    assert.equal(byCatalogId('trueshot-aura').tooltipSpellId, 1299346)
  })

  it('reports no highest-rank icon differences: every tile icon is the catalog spell\'s icon', () => {
    for (const tile of tiles) assert.equal(tile.iconUrl, iconUrl(tile.spellId), tile.key)
  })

  it('marks text taken from the per-rank change list, and only where the tooltip had unresolved formulas', () => {
    const fromChangeList = Object.values(spellInfo).filter((info) => info.descriptionSource === 'change-list').map((info) => info.name).sort()
    assert.deepEqual(fromChangeList, ['Flametongue Totem', 'Windfury Totem'])
  })
})

describe('icon selection', () => {
  it('builds the Wowhead icon URL from the spell ID', () => {
    assert.equal(iconName(5242), 'ability_warrior_battleshout')
    assert.equal(iconUrl(5242), 'https://wow.zamimg.com/images/wow/icons/medium/ability_warrior_battleshout.jpg')
    assert.equal(iconUrl(undefined), undefined)
    assert.equal(iconUrl(999999999), undefined)
  })

  it('has an icon for every spell ID in the catalog, including encounter-specific entries', () => {
    for (const entry of coverageEffects) assert.ok(iconName(entry.spellId), `${entry.id} (${entry.spellId}) has no icon`)
  })

  it('shows one representative icon per requirement: the first effect with an icon', () => {
    const effects = [effect({ id: 'x', kind: 'debuff', stackGroup: 'g' }), effect({ id: 'y', kind: 'debuff', stackGroup: 'g', spellId: 5242 }), effect({ id: 'z', kind: 'debuff', stackGroup: 'g', spellId: 1130 })]
    assert.equal(representativeEffect(effects).id, 'y')
    const [tile, ...rest] = coverageTiles(effects, [member('1', 'Alpha')])
    assert.equal(rest.length, 0)
    assert.equal(tile.spellId, 5242)
    assert.equal(tile.iconUrl, iconUrl(5242))
    assert.deepEqual(tile.alternatives, ['x', 'z'])
  })

  it('falls back to initials when no effect has an icon', () => {
    const [tile] = coverageTiles([effect({ id: 'plain', name: 'Plain Effect', kind: 'raid-buff' })], [member('1', 'Alpha')])
    assert.equal(tile.iconUrl, undefined)
    assert.equal(tile.initials, 'Pl')
  })

  it('uses one tile, not one per alternative, for the real armor reduction requirement', () => {
    const tiles = coverageTiles(coverageEffects, [member('1', 'Warrior')])
    const armor = tiles.filter((tile) => tile.name.includes('Sunder Armor'))
    assert.equal(armor.length, 1)
    assert.ok(armor[0].alternatives.length >= 2)
    assert.ok(armor[0].iconUrl)
    assert.equal(tiles.every((tile) => tile.iconUrl), true)
  })
})

describe('tooltip content', () => {
  it('lists the eligible classes, the team classes, the status and the uncertainty', () => {
    const effects = [effect({ id: 'e', name: 'Eff', kind: 'targeted-buff', confidence: 'provisional', scopeStatus: 'provisional', providers: [{ className: 'Alpha' }, { className: 'Beta', talent: 'T' }] })]
    const [tile] = coverageTiles(effects, [member('1', 'Alpha'), member('2', 'Alpha'), member('3', 'Gamma')])
    assert.equal(tile.title, 'Eff')
    assert.equal(tile.basis, 'estimated')
    assert.equal(tile.estimated, true)
    assert.ok(tile.lines.includes('Eligible providers: Alpha; Beta (needs talent or rune)'))
    assert.ok(tile.lines.includes('Guaranteed in this team: Alpha (spec not set) ×2'))
    assert.ok(tile.lines[0].startsWith('Estimate:'))
    assert.ok(tile.lines.some((line) => line.startsWith('Estimate: provisional')))
    assert.ok(tile.lines.some((line) => line.includes('talent or rune')))
    assert.ok(tile.lines.some((line) => line.startsWith('Targeted')))
    assert.equal(tile.label, 'Eff: Estimated Available')
  })

  it('says "none" when no eligible class is assigned', () => {
    const [tile] = coverageTiles([effect({ id: 'e', kind: 'raid-buff' })], [member('1', 'Beta')])
    assert.ok(tile.lines.includes('In this team: none'))
    assert.equal(tile.status, 'missing')
  })

  it('includes the conflict explanation for a Contested requirement', () => {
    const effects = [effect({ id: 'a', kind: 'raid-buff', slot: 's' }), effect({ id: 'b', kind: 'raid-buff', slot: 's' })]
    const tiles = coverageTiles(effects, [member('1', 'Alpha')])
    assert.deepEqual(tiles.map((tile) => tile.status), ['contested', 'contested'])
    assert.ok(tiles[0].lines.some((line) => line.startsWith('Cannot all be served together with: b')))
  })

  it('never claims verified coverage for the real catalog, and explains the estimate or the lack of data', () => {
    for (const tile of coverageTiles(coverageEffects, [member('1', 'Warrior'), member('2', 'Druid')])) {
      assert.notEqual(tile.basis, 'verified')
      assert.ok(tile.lines.some((line) => /^(Estimate:|Unverified:)/.test(line)), tile.key)
    }
  })
})

describe('collapsed summary and default state', () => {
  it('is collapsed by default', () => {
    assert.equal(STRIP_DEFAULT_OPEN, false)
  })

  it('counts statuses in a fixed order and omits empty ones', () => {
    const effects = [
      effect({ id: 'a', kind: 'raid-buff' }),
      effect({ id: 'b', kind: 'debuff', providers: [{ className: 'Beta' }] }),
      effect({ id: 'c', kind: 'debuff', providers: [{ className: 'Beta' }] }),
      effect({ id: 'u', kind: 'raid-buff', confidence: 'unverified' }),
      effect({ id: 'q', kind: 'party-buff' }),
    ]
    const tiles = coverageTiles(effects, [member('1', 'Alpha')])
    const counts = statusCounts(tiles)
    assert.deepEqual(counts.map((entry) => [entry.status, entry.count]), [['available', 1], ['missing', 2], ['party-unknown', 1], ['unverified', 1]])
    assert.equal(counts.reduce((sum, entry) => sum + entry.count, 0), tiles.length)
    assert.ok(counts.every((entry) => entry.glyph && entry.label))
  })

  it('has no summary for an empty catalog and splits the real catalog into estimated and unverified', () => {
    assert.deepEqual(statusCounts(coverageTiles([], [member('1', 'Alpha')])), [])
    const counts = statusCounts(coverageTiles(coverageEffects, [member('1', 'Warrior')]))
    assert.equal(counts.reduce((sum, entry) => sum + entry.count, 0), VISIBLE_REQUIREMENTS)
    assert.ok(!counts.some((entry) => entry.status === 'unverified'))
    assert.ok(counts.filter((entry) => entry.estimated).every((entry) => entry.label.startsWith('Est. ')))
    assert.ok(counts.every((entry) => entry.estimated !== (entry.status === 'unverified' || entry.status === 'party-unknown')))
  })
})
