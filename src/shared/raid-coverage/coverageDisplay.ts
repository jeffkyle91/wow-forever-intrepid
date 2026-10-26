import { calculateCoverage } from './calculateCoverage.ts'
import { bestPlanned, plannableFor } from './consumables.ts'
import { activeProviders, buildTooltip, describeSpell, providerRulesOf, representativeEffect, tally } from './coverageTooltip.ts'
import type { CoverageTooltip } from './coverageTooltip.ts'
import { iconUrl, iconUrlFromName } from './spellIcons.ts'
import type { ConsumableAlternative, CoverageBasis, CoverageEffect, CoverageMember, CoverageStatus, RequirementResult } from './types.ts'

export const DESCRIPTION_UNAVAILABLE = 'Highest-rank spell description unavailable'

// How an icon reads at a glance, like an action bar: covered is full colour, missing is dark and red, uncertain is muted grey,
// and a planned consumable is muted gold. Colour is never the only signal: the status text, badge glyph and accessible name remain.
export type CoverageVisual = 'covered' | 'missing' | 'uncertain' | 'consumable'

// Applied to the spell icon image. Covered must stay untouched; the others are visibly dimmed.
export const visualTreatments: Record<CoverageVisual, { filter: string; opacity: number }> = {
  covered: { filter: 'none', opacity: 1 },
  missing: { filter: 'grayscale(0.9) brightness(0.45)', opacity: 0.85 },
  uncertain: { filter: 'grayscale(0.6) brightness(0.8)', opacity: 0.8 },
  consumable: { filter: 'sepia(0.7) saturate(1.1) brightness(0.8)', opacity: 0.9 },
}

export const visualOf = (status: CoverageStatus): CoverageVisual => (status === 'available' ? 'covered' : status === 'missing' ? 'missing' : 'uncertain')

export const statusLabels: Record<CoverageStatus, string> = {
  available: 'Available',
  contested: 'Contested',
  missing: 'Missing',
  potential: 'Potential',
  unverified: 'Not calculated',
  'party-unknown': 'Party Unknown',
  indeterminate: 'Not calculated',
}

export const statusHints: Record<CoverageStatus, string> = {
  available: 'An eligible provider is assigned, and no modelled conflict was found. Available describes roster coverage, not whether the spell is active.',
  contested: 'Eligible providers exist, but competing effects cannot all be guaranteed simultaneously.',
  indeterminate: 'Too many competing effects to check within the limit; coverage remains unknown.',
  missing: 'Not enough eligible providers are assigned.',
  potential: 'Assigned candidates need a talent, rune or specialization that is not recorded.',
  unverified: 'Coverage could not be calculated.',
  'party-unknown': 'Party groups are not tracked, so actual coverage is unknown.',
}

// A glyph as well as a colour, so the state never depends on colour alone.
export const statusGlyphs: Record<CoverageStatus, string> = {
  available: '✓',
  contested: '↔',
  indeterminate: '⚠',
  missing: '✕',
  potential: '?',
  unverified: '?',
  'party-unknown': '?',
}

// Badge for a planned consumable, which is not class coverage.
export const consumableGlyph = 'C'

// Extra sentence explaining a Contested or Not calculated result; empty for other statuses.
export function conflictExplanation(requirement: RequirementResult): string {
  const { conflict, limitReason } = requirement
  if (requirement.status === 'contested' && conflict) {
    const others = conflict.requirementNames.filter((_, index) => conflict.requirementKeys[index] !== requirement.key)
    return `Cannot all be served together with: ${others.join(', ')} (needs ${conflict.demand} players; at most ${conflict.maxCoverable} can be covered).`
  }
  if (requirement.status === 'indeterminate' && limitReason) {
    if (limitReason.cause === 'too-many-requirements') return `Too many requirements compete for the ${limitReason.slot} slot to check.`
    return `The ${limitReason.slot} slot check stopped at its ${limitReason.nodeLimit}-step limit.`
  }
  return ''
}

// Statuses that claim something about coverage. Party Unknown, Not calculated and Unverified claim nothing, so they are never "estimated".
const claimingStatuses: CoverageStatus[] = ['available', 'missing', 'potential', 'contested']
export const isEstimatedResult = (basis: CoverageBasis, status: CoverageStatus) => basis === 'estimated' && claimingStatuses.includes(status)

export const displayLabel = (status: CoverageStatus) => statusLabels[status]
export const displayHint = (status: CoverageStatus) => statusHints[status]

export type CoverageTile = {
  key: string
  // Full requirement name (all alternatives), kept for the existing accessible name and tests.
  name: string
  // Name of the representative effect, shown first in the tooltip.
  title: string
  // Accepted-catalog planning result shown on the icon, independent of research confidence.
  status: CoverageStatus
  basis: CoverageBasis
  // Internal research estimate marker, never used for labels, styling or help content.
  estimated: boolean
  // Plain planning status label; research confidence remains internal.
  statusLabel: string
  glyph: string
  // Accessible name: the spell name and actual planning status. Provider requirements are in the help popover.
  label: string
  // The icon's spell name and stored description, shown alongside planning details in the help popover,
  // or DESCRIPTION_UNAVAILABLE when none could be read accurately.
  spellName: string
  description: string
  descriptionAvailable: boolean
  spellId?: number
  iconUrl?: string
  // Short text shown if there is no icon or it fails to load.
  initials: string
  alternatives: string[]
  providerClasses: string[]
  // Who in this team can provide it, with specializations named.
  team: TeamEligibility
  // User-facing planning explanation: provider eligibility, talents, party limits and conflicts.
  lines: string[]
  // How the icon is drawn (see visualTreatments). A planned consumable on a requirement that class coverage does not satisfy is 'consumable'.
  visual: CoverageVisual
  // Structured planning help content, built from local catalog data only.
  tooltip: CoverageTooltip
  // The best planned consumable standing in for this requirement. It never changes `status`.
  consumable?: ConsumableAlternative
  // Consumables that could be planned for this requirement (verified entries only).
  consumableOptions: ConsumableAlternative[]
}

export const STRIP_DEFAULT_OPEN = false

// Effects shown in the everyday checklist. Encounter-specific entries stay in the catalog but are not calculated or shown.
export const standardEffects = (effects: CoverageEffect[]) => effects.filter((effect) => (effect.visibility ?? 'standard') === 'standard')
export const inactiveEffects = (effects: CoverageEffect[]) => effects.filter((effect) => effect.visibility === 'inactive')
export const encounterEffects = (effects: CoverageEffect[]) => effects.filter((effect) => effect.visibility === 'encounter')

export { representativeEffect }

function providerClassesOf(effects: CoverageEffect[]): string[] {
  const classes = new Map<string, boolean>()
  for (const effect of effects) {
    for (const provider of effect.providers) {
      classes.set(provider.className, (classes.get(provider.className) ?? true) && Boolean(provider.talent))
    }
  }
  return [...classes].map(([className, talentOnly]) => (talentOnly ? `${className} (talent)` : className))
}

const uniqueMembers = (members: CoverageMember[]) => [...new Map(members.map((member) => [member.id, member])).values()]

export type TeamEligibility = { guaranteed: string[]; assumed: string[]; possible: string[]; ineligible: string[] }

// Who in the team can provide the requirement: guaranteed, assumed from the specialization (explicit catalog assumption), possible
// (talent, rune or an unreadable specialization), or ineligible (a provider class whose specialization cannot provide it).
// Classes that provide nothing here are not listed.
function teamEligibilityOf(requirement: RequirementResult, members: CoverageMember[]): TeamEligibility {
  const { matches, effects } = requirement
  const providerClasses = new Set(effects.flatMap((effect) => effect.providers.map((provider) => provider.className.trim().toLowerCase())))
  const idsWith = (eligibility: string) => new Set(matches.filter((match) => match.eligibility === eligibility).map((match) => match.playerId))
  const guaranteedIds = idsWith('guaranteed')
  const assumedIds = new Set([...idsWith('assumed')].filter((id) => !guaranteedIds.has(id)))
  const matchedIds = new Set(matches.map((match) => match.playerId))
  return {
    guaranteed: tally(members.filter((member) => guaranteedIds.has(member.id))),
    assumed: tally(members.filter((member) => assumedIds.has(member.id))),
    possible: tally(members.filter((member) => matchedIds.has(member.id) && !guaranteedIds.has(member.id) && !assumedIds.has(member.id))),
    ineligible: tally(members.filter((member) => !matchedIds.has(member.id) && providerClasses.has(member.className.trim().toLowerCase()))),
  }
}

// Operational limitations only; source/confidence notes remain in the catalog.
function uncertaintyOf(requirement: RequirementResult): string[] {
  const notes: string[] = []
  if (requirement.effects.some((effect) => effect.providers.some((provider) => provider.talent))) notes.push('Some providers need a talent or rune that is not tracked.')
  if (requirement.matches.some((match) => match.eligibility === 'assumed')) notes.push('The catalog assumes this talent for the assigned specialization; individual talent selections are not tracked.')
  if (requirement.kind === 'targeted-buff') notes.push('Targeted: eligible providers are listed; not every player is assumed to receive it.')
  return notes
}

export function planningExplanation(requirement: RequirementResult): string {
  return conflictExplanation({ ...requirement, ...requirement.planning })
}

// One tile per requirement, from the same engine as the detailed panel. Empty when there is no catalog.
// Planning accepts the catalog. `basis` and `estimated` retain research metadata internally only.
export function coverageTiles(effects: CoverageEffect[], members: CoverageMember[], options?: { nodeLimit?: number; consumables?: ConsumableAlternative[]; planned?: ReadonlySet<string> }): CoverageTile[] {
  return calculateCoverage(standardEffects(effects), members, options).requirements.map((requirement) => {
    const representative = representativeEffect(requirement.effects)
    const { status } = requirement.planning
    const estimated = isEstimatedResult(requirement.basis, status)
    const conflict = planningExplanation(requirement)
    const providerClasses = providerClassesOf(requirement.effects)
    const providerRules = providerRulesOf(requirement.effects)
    const team = teamEligibilityOf(requirement, uniqueMembers(members))
    const alternatives = requirement.effects.filter((effect) => effect !== representative).map((effect) => effect.name)
    const lines = [
      displayHint(status),
      ...(conflict ? [conflict] : []),
      `Eligible providers: ${providerRules.join('; ')}`,
      ...(team.guaranteed.length ? [`Guaranteed in this team: ${team.guaranteed.join(', ')}`] : []),
      ...(team.assumed.length ? [`Assumed from roster specialization (talent not tracked): ${team.assumed.join(', ')}`] : []),
      ...(team.possible.length ? [`Possible in this team (talent, rune or specialization not confirmed): ${team.possible.join(', ')}`] : []),
      ...(!team.guaranteed.length && !team.assumed.length && !team.possible.length ? ['In this team: none'] : []),
      ...(team.ineligible.length ? [`Not eligible in this team: ${team.ineligible.join(', ')}`] : []),
      ...(alternatives.length ? [`Also: ${alternatives.join(', ')}`] : []),
      ...uncertaintyOf(requirement),
    ]
    // The spell the icon and tooltip name: the provider currently satisfying a covered requirement, else the representative.
    const shown = status === 'available' ? activeProviders(requirement)[0]?.effect ?? representative : representative
    const spell = describeSpell(shown)
    const spellName = spell.name
    const description = spell.description
    const consumableOptions = plannableFor(options?.consumables ?? [], requirement.key)
    const consumable = status === 'available' ? undefined : bestPlanned(options?.consumables ?? [], requirement.key, options?.planned ?? new Set())
    const visual: CoverageVisual = consumable ? 'consumable' : visualOf(status)
    const statusLabel = displayLabel(status)
    const tooltip = buildTooltip({
      requirement,
      state: visual,
      statusLabel,
      reason: conflict || displayHint(status),
      representative,
      consumable,
    })
    return {
      key: requirement.key,
      name: requirement.name,
      title: representative.name,
      status,
      basis: requirement.basis,
      estimated,
      statusLabel,
      glyph: consumable ? consumableGlyph : statusGlyphs[status],
      label: `${spellName}: ${statusLabel}${consumable ? `. Planned consumable: ${consumable.name}` : ''}`,
      spellName,
      description: description ?? DESCRIPTION_UNAVAILABLE,
      descriptionAvailable: description !== undefined,
      spellId: shown.spellId,
      iconUrl: (consumable && (iconUrlFromName(consumable.iconName) ?? iconUrl(consumable.spellId))) || spell.iconUrl,
      initials: shown.name.replace(/[^A-Za-z]/g, '').slice(0, 2),
      alternatives,
      providerClasses,
      team,      lines,
      visual,
      tooltip,
      consumable,
      consumableOptions,
    }
  })
}

const summaryOrder: CoverageStatus[] = ['available', 'potential', 'contested', 'missing', 'party-unknown', 'unverified', 'indeterminate']

export type StatusCount = { status: CoverageStatus; estimated: boolean; estimatedCount: number; count: number; glyph: string; label: string }

// One count per planning status. Research counts remain internal, never rendered as warnings.
export function statusCounts(tiles: CoverageTile[]): StatusCount[] {
  return summaryOrder.map((status) => {
    const matching = tiles.filter((tile) => tile.status === status)
    const estimatedCount = matching.filter((tile) => tile.estimated).length
    return {
      status,
      estimated: estimatedCount > 0,
      estimatedCount,
      count: matching.length,
      glyph: statusGlyphs[status],
      label: displayLabel(status),
    }
  }).filter((entry) => entry.count > 0)
}
