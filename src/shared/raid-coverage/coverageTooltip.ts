import { spellInfo } from './spellDescriptions.ts'
import { iconUrl } from './spellIcons.ts'
import type { ConsumableAlternative, CoverageEffect, ProviderMatch, RequirementResult } from './types.ts'

// Planning help content from the accepted local catalog. Research metadata is retained, never rendered as a warning.

export const MISSING_SPELL_LIMIT = 4
export const UNCERTAIN_SPELL_LIMIT = 2

export type TipSpell = {
  name: string
  // Highest WoW Forever rank from spellDescriptions.ts; absent for an unranked spell or one with no stored info.
  rank?: string
  description?: string
  spellId?: number
  iconUrl?: string
  // Which classes (and specializations) can provide it, straight from the catalog's provider rules.
  providers: string
  // Internal research-pass eligibility, independent of accepted-catalog planning coverage.
  counted: boolean
}

export type TooltipState = 'covered' | 'missing' | 'uncertain' | 'consumable'

export type CoverageTooltip = {
  state: TooltipState
  heading: string
  // The status, as plain words.
  headline: string
  spells: TipSpell[]
  // Spells left out to keep the tooltip short.
  hiddenSpells: number
  notes: string[]
}

export type RosterPlayer = { id: string; className: string; specialization: string }

// "Feral Druid ×2": the specialization is part of the name so a count never hides which specs are in the team.
export function tally(players: RosterPlayer[]): string[] {
  const counts = new Map<string, Set<string>>()
  for (const player of players) {
    const spec = player.specialization.trim()
    const label = spec ? `${spec} ${player.className}` : `${player.className} (spec not set)`
    counts.set(label, (counts.get(label) ?? new Set()).add(player.id))
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([label, ids]) => (ids.size > 1 ? `${label} ×${ids.size}` : label))
}

// Which classes and specializations can provide the effects, for example "Druid (Feral, Guardian; needs talent or rune)".
export function providerRulesOf(effects: CoverageEffect[]): string[] {
  const rules = effects.flatMap((effect) => effect.providers.map((provider) => {
    const detail = [provider.specs?.join(', '), provider.talent ? 'needs talent or rune' : '', provider.assumed ? `assumed for ${provider.assumed.specs.join(', ')}` : ''].filter(Boolean).join('; ')
    return detail ? `${provider.className} (${detail})` : provider.className
  }))
  return [...new Set(rules)]
}

// The effect marked `representative` in the catalog, else the first with a known icon, so the choice depends only on catalog data.
export function representativeEffect(effects: CoverageEffect[]): CoverageEffect {
  return effects.find((effect) => effect.representative && iconUrl(effect.spellId)) ?? effects.find((effect) => iconUrl(effect.spellId)) ?? effects[0]
}

export const isCounted = (effect: CoverageEffect) => effect.confidence !== 'unverified' && effect.scopeStatus !== 'unknown'
const isConfirmed = (effect: CoverageEffect) => effect.confidence === 'confirmed' && effect.scopeStatus === 'confirmed'

export function describeSpell(effect: CoverageEffect): TipSpell {
  const info = effect.spellId === undefined ? undefined : spellInfo[effect.spellId]
  return {
    name: info?.name ?? effect.name,
    rank: info?.rank,
    description: info?.description,
    spellId: effect.spellId,
    iconUrl: iconUrl(effect.spellId),
    providers: providerRulesOf([effect]).join('; '),
    counted: isCounted(effect),
  }
}

const providesNow = (match: ProviderMatch) => match.eligibility === 'guaranteed' || match.eligibility === 'assumed'

export type ActiveProvider = { effect: CoverageEffect; players: string[] }

// The effects whose roster players can provide the requirement now, best first. Deterministic: guaranteed players before assumed ones,
// confirmed data before provisional, the catalog's representative effect, then catalog order. The first entry is the spell the tooltip shows as covering it.
export function activeProviders(requirement: RequirementResult): ActiveProvider[] {
  const preferred = representativeEffect(requirement.effects)
  // A party-wide provider never satisfies a requirement while a wider-scope alternative can, so it is not offered as the covering spell.
  const wideProviders = requirement.effects.some((effect) => effect.kind !== 'party-buff' && requirement.matches.some((match) => match.effectId === effect.id && providesNow(match)))
  return requirement.effects
    .filter((effect) => !wideProviders || effect.kind !== 'party-buff')
    .map((effect, index) => {
      const matches = requirement.matches.filter((match) => match.effectId === effect.id && providesNow(match))
      const best = matches.some((match) => match.eligibility === 'guaranteed') ? 0 : 1
      return { effect, index, matches, order: [best, isConfirmed(effect) ? 0 : 1, effect === preferred ? 0 : 1, index] }
    })
    .filter((entry) => entry.matches.length > 0)
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2] || a.order[3] - b.order[3])
    .map(({ effect, matches }) => ({ effect, players: tally(matches.map((match) => ({ id: match.playerId, className: match.className, specialization: match.specialization }))) }))
}

type TooltipInput = {
  requirement: RequirementResult
  state: TooltipState
  statusLabel: string
  // Why the result is uncertain, one sentence (for example the status hint or the slot conflict).
  reason: string
  representative: CoverageEffect
  consumable?: ConsumableAlternative
}

export function buildTooltip(input: TooltipInput): CoverageTooltip {
  const { requirement, state, statusLabel, reason, representative, consumable } = input
  const effects = requirement.effects
  const fit = (spells: CoverageEffect[], limit: number) => ({ spells: spells.slice(0, limit).map(describeSpell), hiddenSpells: Math.max(0, spells.length - limit) })

  if (state === 'consumable' && consumable) {
    return {
      state,
      heading: consumable.name,
      headline: 'Planned consumable (not class coverage)',
      spells: [],
      hiddenSpells: 0,
      notes: [consumable.effect, `Weaker or different: ${consumable.limitation}`, `Class coverage for ${requirement.name}: ${statusLabel}.`, 'Planned on this device only; not shared with the guild.'],
    }
  }

  if (state === 'covered') {
    const [active, ...others] = activeProviders(requirement)
    const main = active?.effect ?? representative
    return {
      state,
      heading: describeSpell(main).name,
      headline: statusLabel,
      ...fit([main], 1),
      notes: [
        ...(active?.players.length ? [`Provided by: ${active.players.join(', ')}`] : []),
        ...(others.length ? [`Also available: ${others.map((other) => describeSpell(other.effect).name).join(', ')}`] : []),
      ],
    }
  }

  if (state === 'missing') {
    return {
      state,
      heading: requirement.name,
      headline: `${statusLabel}. Can be provided by:`,
      ...fit(effects, MISSING_SPELL_LIMIT),
      notes: [reason],
    }
  }

  return {
    state,
    heading: describeSpell(representative).name,
    headline: statusLabel,
    ...fit(effects, UNCERTAIN_SPELL_LIMIT),
    notes: [reason],
  }
}
