import type { ConsumableAlternative, CoverageEffect } from './types.ts'

// Unverified entries are research only: they can be listed in the catalog but not planned.
export const isPlannable = (consumable: ConsumableAlternative) => consumable.confidence !== 'unverified'

export const plannableFor = (consumables: ConsumableAlternative[], requirementKey: string) =>
  consumables.filter((consumable) => consumable.requirementKey === requirementKey && isPlannable(consumable))

// The best planned alternative: the first in catalog order, so list stronger consumables first. Nothing is planned by default.
export function bestPlanned(consumables: ConsumableAlternative[], requirementKey: string, planned: ReadonlySet<string>): ConsumableAlternative | undefined {
  return plannableFor(consumables, requirementKey).find((consumable) => planned.has(consumable.id))
}

export function validateConsumables(consumables: ConsumableAlternative[], effects: CoverageEffect[]): string[] {
  const problems: string[] = []
  const keys = new Set(effects.map((effect) => effect.stackGroup ?? effect.id))
  const ids = new Set<string>()
  for (const consumable of consumables) {
    const { id } = consumable
    if (ids.has(id)) problems.push(`Duplicate consumable id: ${id}`)
    ids.add(id)
    if (!keys.has(consumable.requirementKey)) problems.push(`${id}: requirementKey "${consumable.requirementKey}" is not a stackGroup or effect id in the catalog`)
    if (!consumable.sources.length) problems.push(`${id}: no source`)
    if (!consumable.effect.trim()) problems.push(`${id}: effect text is required`)
    if (!consumable.limitation.trim()) problems.push(`${id}: limitation text is required`)
    if (consumable.verifiedOn && !/^\d{4}-\d{2}-\d{2}$/.test(consumable.verifiedOn)) problems.push(`${id}: verifiedOn must be YYYY-MM-DD`)
    if (consumable.confidence === 'confirmed' && !consumable.verifiedOn) problems.push(`${id}: confirmed entries need verifiedOn`)
  }
  return problems
}

// Plans live only in this browser (localStorage), keyed by team. They are never written to Firestore or shared with the guild.
export const PLANS_STORAGE_KEY = 'intrepid-raid-coverage-planned-consumables-v1'

type Plans = Record<string, string[]>

export function parsePlans(raw: string | null): Plans {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((id) => typeof id === 'string')))
  } catch {
    return {}
  }
}

export function togglePlan(plans: Plans, scope: string, id: string, on: boolean): Plans {
  const rest = (plans[scope] ?? []).filter((existing) => existing !== id)
  return { ...plans, [scope]: on ? [...rest, id] : rest }
}

// Ids that no longer exist or can no longer be planned are dropped, so removing a catalog entry cannot leave a stale plan.
export const plannedIds = (plans: Plans, scope: string, consumables: ConsumableAlternative[]): Set<string> =>
  new Set((plans[scope] ?? []).filter((id) => consumables.some((consumable) => consumable.id === id && isPlannable(consumable))))
