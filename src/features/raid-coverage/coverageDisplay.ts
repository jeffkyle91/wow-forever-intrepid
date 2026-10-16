import { calculateCoverage } from './calculateCoverage.ts'
import { spellInfo } from './spellDescriptions.ts'
import { iconUrl } from './spellIcons.ts'
import type { CoverageBasis, CoverageEffect, CoverageMember, CoverageStatus, RequirementResult } from './types.ts'

export const DESCRIPTION_UNAVAILABLE = 'Highest-rank spell description unavailable'

export const statusLabels: Record<CoverageStatus, string> = {
  available: 'Available',
  contested: 'Contested',
  missing: 'Missing',
  potential: 'Potential',
  unverified: 'Unverified',
  'party-unknown': 'Party Unknown',
  indeterminate: 'Not calculated',
}

export const statusHints: Record<CoverageStatus, string> = {
  available: 'A confirmed provider is assigned, and no modelled conflict was found. This is not a guarantee it is active in game.',
  contested: 'Eligible providers exist, but competing effects cannot all be guaranteed simultaneously.',
  indeterminate: 'Too many competing effects to check within the limit; neither confirmed nor ruled out.',
  missing: 'No confirmed provider is assigned.',
  potential: 'Only providers that need a talent we cannot check.',
  unverified: 'Not confirmed for WoW Forever; not counted as coverage.',
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

// The same explanation for the estimate, which may differ from the verified result when provisional effects are counted.
export function estimateExplanation(requirement: RequirementResult): string {
  const { estimate } = requirement
  return conflictExplanation({ ...requirement, status: estimate.status, conflict: estimate.conflict, limitReason: estimate.limitReason })
}

// Statuses that claim something about coverage. Party Unknown, Not calculated and Unverified claim nothing, so they are never "estimated".
const claimingStatuses: CoverageStatus[] = ['available', 'missing', 'potential', 'contested']
export const isEstimatedResult = (basis: CoverageBasis, status: CoverageStatus) => basis === 'estimated' && claimingStatuses.includes(status)

export const estimatedHints: Partial<Record<CoverageStatus, string>> = {
  available: 'Estimate: a provider whose data is provisional is assigned, and no modelled conflict was found. Not verified in game.',
  contested: 'Estimate: eligible providers exist, but competing effects cannot all be guaranteed simultaneously. Not verified in game.',
  missing: 'Estimate: no provider with supported data is assigned. Unverified alternatives are not counted.',
  potential: 'Estimate: only providers that need a talent we cannot check. Not verified in game.',
}

export const displayLabel = (status: CoverageStatus, estimated: boolean) => (estimated ? `Estimated ${statusLabels[status]}` : statusLabels[status])
export const displayHint = (status: CoverageStatus, estimated: boolean) => (estimated ? estimatedHints[status] ?? statusHints[status] : statusHints[status])

export type CoverageTile = {
  key: string
  // Full requirement name (all alternatives), kept for the existing accessible name and tests.
  name: string
  // Name of the representative effect, shown first in the tooltip.
  title: string
  // Roster result shown on the icon: from confirmed and provisional effects together. Equals the verified result when basis is 'verified'.
  status: CoverageStatus
  basis: CoverageBasis
  // True when the result relies on provisional data and claims coverage (Available, Missing, Potential or Contested).
  estimated: boolean
  // "Estimated Available" for an estimate, plain "Available" for a verified result.
  statusLabel: string
  glyph: string
  // Accessible name: the spell name and the coverage status. The status is not shown in the mouseover tooltip.
  label: string
  // What the mouseover tooltip shows, and nothing else: the icon's own spell name and its Wowhead Forever description,
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
  // The calculation explanation (eligibility, confidence, uncertainty). Not shown in the tooltip; kept for tests and detail views.
  lines: string[]
}

export const STRIP_DEFAULT_OPEN = false

// Effects shown in the everyday checklist. Encounter-specific entries stay in the catalog but are not calculated or shown.
export const standardEffects = (effects: CoverageEffect[]) => effects.filter((effect) => (effect.visibility ?? 'standard') === 'standard')
export const encounterEffects = (effects: CoverageEffect[]) => effects.filter((effect) => effect.visibility === 'encounter')

// The first effect of a requirement that has a known icon, so the choice does not depend on anything but catalog order.
export function representativeEffect(effects: CoverageEffect[]): CoverageEffect {
  return effects.find((effect) => iconUrl(effect.spellId)) ?? effects[0]
}

function providerClassesOf(effects: CoverageEffect[]): string[] {
  const classes = new Map<string, boolean>()
  for (const effect of effects) {
    for (const provider of effect.providers) {
      classes.set(provider.className, (classes.get(provider.className) ?? true) && Boolean(provider.talent))
    }
  }
  return [...classes].map(([className, talentOnly]) => (talentOnly ? `${className} (talent)` : className))
}

// Which classes and specializations can provide the requirement, for example "Druid (Feral, Guardian; needs talent or rune)".
function providerRulesOf(effects: CoverageEffect[]): string[] {
  const rules = effects.flatMap((effect) => effect.providers.map((provider) => {
    const detail = [provider.specs?.join(', '), provider.talent ? 'needs talent or rune' : '', provider.assumed ? `assumed for ${provider.assumed.specs.join(', ')}` : ''].filter(Boolean).join('; ')
    return detail ? `${provider.className} (${detail})` : provider.className
  }))
  return [...new Set(rules)]
}

type RosterPlayer = { id: string; className: string; specialization: string }
const uniqueMembers = (members: CoverageMember[]) => [...new Map(members.map((member) => [member.id, member])).values()]

// "Feral Druid ×2": the specialization is part of the name so a count never hides which specs are in the team.
function tally(players: RosterPlayer[]): string[] {
  const counts = new Map<string, Set<string>>()
  for (const player of players) {
    const spec = player.specialization.trim()
    const label = spec ? `${spec} ${player.className}` : `${player.className} (spec not set)`
    counts.set(label, (counts.get(label) ?? new Set()).add(player.id))
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([label, ids]) => (ids.size > 1 ? `${label} ×${ids.size}` : label))
}

export type TeamEligibility = { guaranteed: string[]; assumed: string[]; possible: string[]; ineligible: string[] }

// Who in the team can provide the requirement: guaranteed, assumed from the specialization (explicit catalog assumption), possible
// (talent, rune or an unreadable specialization), or ineligible (a provider class whose specialization cannot provide it).
// Classes that provide nothing here are not listed.
function teamEligibilityOf(requirement: RequirementResult, members: CoverageMember[]): TeamEligibility {
  const matches = requirement.basis === 'unverified' ? requirement.matches : requirement.matches.filter((match) => match.estimable)
  const effects = requirement.basis === 'unverified' ? requirement.effects : requirement.effects.filter((effect) => effect.confidence !== 'unverified' && effect.scopeStatus !== 'unknown')
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

// What is uncertain about a requirement, in plain words. Empty when every effect is confirmed and no other caveat applies.
function uncertaintyOf(requirement: RequirementResult): string[] {
  const notes: string[] = []
  const isUnverified = (effect: CoverageEffect) => effect.confidence === 'unverified' || effect.scopeStatus === 'unknown'
  const counted = requirement.effects.filter((effect) => !isUnverified(effect))
  const uncounted = requirement.effects.filter(isUnverified)
  if (requirement.basis === 'unverified') notes.push('Unverified: wording is ambiguous or information conflicts, so it is not counted and not checked in game.')
  else if (requirement.basis === 'estimated') {
    const provisional = counted.filter((effect) => effect.confidence !== 'confirmed' || effect.scopeStatus !== 'confirmed')
    notes.push(`Estimate: provisional Wowhead Forever data (${provisional.map((effect) => effect.name).join(', ')}); not verified in game.`)
  }
  if (requirement.basis !== 'unverified' && uncounted.length) notes.push(`Not counted (unverified): ${uncounted.map((effect) => effect.name).join(', ')}.`)
  if (counted.some((effect) => effect.providers.some((provider) => provider.talent))) notes.push('Some providers need a talent or rune that is not tracked.')
  const bases = [...new Set(requirement.matches.filter((match) => match.estimable && match.eligibility === 'assumed' && match.assumption).map((match) => match.assumption))]
  for (const basis of bases) notes.push(`Planning assumption, not a confirmed talent selection or verified Forever mechanic: ${basis}`)
  if (requirement.kind === 'targeted-buff') notes.push('Targeted: eligible providers are listed; not every player is assumed to receive it.')
  return notes
}

// One tile per requirement, from the same engine as the detailed panel. Empty when there is no catalog.
// The status is the roster estimate; `basis` and `estimated` say whether it rests on provisional data.
export function coverageTiles(effects: CoverageEffect[], members: CoverageMember[], options?: { nodeLimit?: number }): CoverageTile[] {
  return calculateCoverage(standardEffects(effects), members, options).requirements.map((requirement) => {
    const representative = representativeEffect(requirement.effects)
    const { status } = requirement.estimate
    const estimated = isEstimatedResult(requirement.basis, status)
    const conflict = estimateExplanation(requirement)
    const providerClasses = providerClassesOf(requirement.basis === 'unverified' ? requirement.effects : requirement.effects.filter((effect) => effect.confidence !== 'unverified' && effect.scopeStatus !== 'unknown'))
    const providerRules = providerRulesOf(requirement.basis === 'unverified' ? requirement.effects : requirement.effects.filter((effect) => effect.confidence !== 'unverified' && effect.scopeStatus !== 'unknown'))
    const team = teamEligibilityOf(requirement, uniqueMembers(members))
    const alternatives = requirement.effects.filter((effect) => effect !== representative).map((effect) => effect.name)
    const lines = [
      displayHint(status, estimated),
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
    const info = representative.spellId === undefined ? undefined : spellInfo[representative.spellId]
    const spellName = info?.name ?? representative.name
    const description = info?.description
    return {
      key: requirement.key,
      name: requirement.name,
      title: representative.name,
      status,
      basis: requirement.basis,
      estimated,
      statusLabel: displayLabel(status, estimated),
      glyph: statusGlyphs[status],
      label: `${spellName}: ${displayLabel(status, estimated)}`,
      spellName,
      description: description ?? DESCRIPTION_UNAVAILABLE,
      descriptionAvailable: description !== undefined,
      spellId: representative.spellId,
      iconUrl: iconUrl(representative.spellId),
      initials: representative.name.replace(/[^A-Za-z]/g, '').slice(0, 2),
      alternatives,
      providerClasses,
      team,
      lines,
    }
  })
}

const summaryOrder: CoverageStatus[] = ['available', 'potential', 'contested', 'missing', 'party-unknown', 'unverified', 'indeterminate']

export type StatusCount = { status: CoverageStatus; estimated: boolean; count: number; glyph: string; label: string }

// Counts per status for the collapsed header, in a fixed order, omitting empty ones. Verified results and estimates are counted apart.
export function statusCounts(tiles: CoverageTile[]): StatusCount[] {
  return summaryOrder.flatMap((status) => [false, true].map((estimated) => ({
    status,
    estimated,
    count: tiles.filter((tile) => tile.status === status && tile.estimated === estimated).length,
    glyph: statusGlyphs[status],
    label: estimated ? `Est. ${statusLabels[status]}` : statusLabels[status],
  }))).filter((entry) => entry.count > 0)
}
