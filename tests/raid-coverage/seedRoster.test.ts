import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage } from '../../src/shared/raid-coverage/calculateCoverage.ts'
import { coverageEffects } from '../../src/shared/raid-coverage/coverageData.ts'
import { coverageTiles, standardEffects } from '../../src/shared/raid-coverage/coverageDisplay.ts'
import { assignedMembers } from '../../src/shared/raid-coverage/teamSelection.ts'
import type { CoverageEffect, CoverageMember } from '../../src/shared/raid-coverage/types.ts'
import type { TenManTeam } from '../../src/guildApi.ts'
import { classSpecializations } from '../../src/shared/game/classes.ts'
import { seedRoster } from '../../scripts/seedRoster.ts'

const players: CoverageMember[] = seedRoster.map((player, index) => ({ id: `player-${index + 1}`, name: player.name, className: player.className, specialization: player.specialization }))
const assignments = Object.fromEntries(seedRoster.map((player, index) => [`player-${index + 1}`, player.team])) as Record<string, TenManTeam>
const team = (key: TenManTeam) => assignedMembers([key], players, assignments)
const tileOf = (members: CoverageMember[], key: string) => coverageTiles(coverageEffects, members).find((tile) => tile.key === key)!

describe('emulator seed roster', () => {
  it('has 40 players, 10 in each of Blue, Yellow, Red and White, with unique invented names', () => {
    assert.equal(seedRoster.length, 40)
    for (const key of ['blue', 'yellow', 'red', 'white'] as const) assert.equal(team(key).length, 10, key)
    assert.equal(new Set(seedRoster.map((player) => player.name)).size, 40)
  })

  it('has every specialization of every roster class at least once, and nothing outside the roster model', () => {
    for (const [className, options] of Object.entries(classSpecializations)) {
      for (const option of options) assert.ok(seedRoster.some((player) => player.className === className && player.specialization === option.name), `${className} ${option.name}`)
    }
    for (const player of seedRoster) assert.ok(classSpecializations[player.className]?.some((option) => option.name === player.specialization), player.name)
  })

  it('keeps the original four players as player-1 to player-4 and has both Warriors and Rogues', () => {
    assert.deepEqual(seedRoster.slice(0, 4).map((player) => [player.name, player.className, player.team]), [['Aldric', 'Warrior', 'blue'], ['Brienne', 'Priest', 'blue'], ['Cormac', 'Mage', 'blue'], ['Delia', 'Rogue', 'blue']])
    assert.ok(seedRoster.some((player) => player.className === 'Warrior') && seedRoster.some((player) => player.className === 'Rogue'))
  })
})

describe('equivalent debuffs: Sunder Armor versus Expose Armor', () => {
  it('shows Sunder Armor with the other available providers when a Warrior is present (Blue)', () => {
    const tile = tileOf(team('blue'), 'armor-reduction')
    assert.equal(tile.status, 'available')
    assert.equal(tile.tooltip.heading, 'Sunder Armor')
    assert.ok(tile.tooltip.notes.includes('Provided by: Protection Warrior'))
    assert.ok(tile.tooltip.notes.includes('Also available: Expose Armor, Faerie Fire, Curse of Recklessness'))
  })

  it('shows Sunder Armor alone from Warriors, with no Expose Armor, when there is no Rogue (Yellow)', () => {
    const tile = tileOf(team('yellow'), 'armor-reduction')
    assert.equal(tile.tooltip.heading, 'Sunder Armor')
    assert.ok(tile.tooltip.notes.includes('Also available: Faerie Fire, Curse of Recklessness'))
  })

  it('shows Expose Armor when only Rogues can provide the Warrior-or-Rogue effect (Red)', () => {
    const tile = tileOf(team('red'), 'armor-reduction')
    assert.equal(tile.status, 'available')
    assert.equal(tile.tooltip.heading, 'Expose Armor')
    assert.equal(tile.spellName, 'Expose Armor')
    assert.ok(tile.tooltip.notes.includes('Provided by: Assassination Rogue, Subtlety Rogue'))
  })

  it('is Missing, and lists every possible spell with its class, when no provider is present (White)', () => {
    const tile = tileOf(team('white'), 'armor-reduction')
    assert.equal(tile.status, 'missing')
    assert.deepEqual(tile.tooltip.spells.map((spell) => [spell.name, spell.providers]), [['Sunder Armor', 'Warrior'], ['Expose Armor', 'Rogue'], ['Faerie Fire', 'Druid'], ['Curse of Recklessness', 'Warlock']])
  })

  it('is one requirement however many alternatives a team has, and each alternative alone satisfies it', () => {
    const armor = standardEffects(coverageEffects).filter((entry) => entry.stackGroup === 'armor-reduction')
    assert.deepEqual(armor.map((entry) => entry.id), ['sunder-armor', 'expose-armor', 'faerie-fire', 'curse-of-recklessness'])
    for (const [className, spell] of [['Warrior', 'Sunder Armor'], ['Rogue', 'Expose Armor'], ['Druid', 'Faerie Fire'], ['Warlock', 'Curse of Recklessness']]) {
      const [requirement, ...rest] = calculateCoverage(armor, [{ id: '1', name: 'P', className, specialization: '' }]).requirements
      assert.equal(rest.length, 0)
      assert.equal(requirement.estimate.status, 'available', spell)
    }
    assert.equal(calculateCoverage(armor, [...team('blue'), ...team('red')]).requirements.length, 1)
  })

  it('applies the same alternative-provider rule to the other consolidated debuffs and buffs', () => {
    const groups: Record<string, string[]> = {
      'melee-attack-power-reduction': ['demoralizing-shout', 'demoralizing-roar', 'hex-of-weakness', 'curse-of-weakness'],
      'attack-speed-reduction': ['thunder-clap'],
      'stamina': ['power-word-fortitude', 'prayer-of-fortitude'],
      'spirit': ['divine-spirit', 'prayer-of-spirit', 'dark-inspiration'],
      'intellect': ['arcane-intellect', 'arcane-brilliance'],
      'mark-of-the-wild': ['mark-of-the-wild', 'gift-of-the-wild'],
      'extra-melee-attacks': ['windfury-totem'],
      'mana-regeneration': ['blessing-of-wisdom', 'mana-spring-totem', 'mana-tide-totem'],
      'melee-attack-power': ['blessing-of-might'],
    }
    const standard = standardEffects(coverageEffects)
    for (const [key, ids] of Object.entries(groups)) assert.deepEqual(standard.filter((entry) => (entry.stackGroup ?? entry.id) === key).map((entry) => entry.id), ids, key)
  })
})

describe('checklist audit', () => {
  const standard = standardEffects(coverageEffects)

  it('has no duplicate spell, and no two requirements share an effect name', () => {
    const ids = standard.map((entry) => entry.spellId)
    assert.equal(new Set(ids).size, ids.length)
    const names = standard.map((entry) => entry.name)
    assert.equal(new Set(names).size, names.length)
  })

  it('has one requirement per group and 23 in total', () => {
    const keys = calculateCoverage(standard, []).requirements.map((requirement) => requirement.key)
    assert.equal(new Set(keys).size, keys.length)
    assert.equal(keys.length, 23)
  })

  it('has no requirement whose group mixes unrelated categories', () => {
    const categories = new Map<string, Set<string | undefined>>()
    for (const entry of standard) categories.set(entry.stackGroup ?? entry.id, (categories.get(entry.stackGroup ?? entry.id) ?? new Set()).add(entry.category))
    for (const [key, set] of categories) assert.equal(set.size, 1, key)
  })
})

describe('coverage across the seeded teams', () => {
  const status = (key: TenManTeam | 'all', requirement: string) => {
    const tile = tileOf(key === 'all' ? players : team(key), requirement)
    return tile.status
  }

  it('respects specialization: talent effects follow the roster specs (assumed specs are estimates)', () => {
    assert.equal(tileOf(team('blue'), 'leader-of-the-pack').estimated, true)
    assert.equal(status('blue', 'leader-of-the-pack'), 'available')
    assert.equal(status('red', 'leader-of-the-pack'), 'potential')
    assert.equal(status('yellow', 'leader-of-the-pack'), 'missing')
    assert.equal(status('yellow', 'moonkin-form'), 'available')
    assert.equal(status('blue', 'moonkin-form'), 'missing')
    assert.equal(status('blue', 'trueshot-aura'), 'potential')
    assert.equal(status('yellow', 'trueshot-aura'), 'missing')
    assert.equal(status('red', 'trueshot-aura'), 'missing')
  })

  it('respects raid-wide scope and class: Windfury needs a Shaman, and Battle Shout a Warrior', () => {
    assert.equal(status('blue', 'extra-melee-attacks'), 'available')
    assert.equal(status('white', 'extra-melee-attacks'), 'available')
    assert.equal(status('red', 'battle-shout'), 'missing')
    assert.equal(status('yellow', 'battle-shout'), 'available')
  })

  it('never shows an excluded or inactive effect in any tooltip for the whole 40-player raid', () => {
    const text = JSON.stringify(coverageTiles(coverageEffects, players).map((tile) => [tile.tooltip, tile.lines, tile.label]))
    for (const name of ['Horn of Lordaeron', 'Wild Strikes', 'Homunculi', 'Vampiric Touch', 'Heart of the Lion', 'Valor of Azeroth', 'Tremor Totem', 'Stoneskin Totem', 'Devotion Aura', 'Fear Ward', 'Judgement', 'Seal of', 'Resistance']) assert.ok(!text.includes(name), name)
  })

  it('keeps every requirement satisfiable or explained for the full raid', () => {
    const tiles = coverageTiles(coverageEffects, players)
    assert.equal(tiles.length, 23)
    for (const tile of tiles) assert.ok(tile.tooltip.heading && tile.tooltip.headline, tile.key)
    const effect: CoverageEffect | undefined = coverageEffects.find((entry) => entry.id === 'sunder-armor')
    assert.ok(effect)
  })
})
