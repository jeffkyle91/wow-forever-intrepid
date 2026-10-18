import { phaseNoOf } from '../../shared/game/phases.ts'

// A priority that was carried over from an earlier phase (see carryOver.ts): where it came from, and what removing it would leave behind. Pure, so Node tests it.
type Source = { phaseNo?: number }

/** The name of the phase a carried-over priority came from; none for a priority that was not carried over or whose source is gone. */
export function carriedFromName(priority: { carriedFrom?: string }, lookup: (id: string) => Source | undefined, phaseName: (no: number) => string): string | undefined {
  const source = priority.carriedFrom ? lookup(priority.carriedFrom) : undefined
  return source ? phaseName(phaseNoOf(source)) : undefined
}

/** "Carried over from Phase 1", or "Carried over" when the priority it came from is gone; nothing for a priority that was not carried over. */
export function carriedLabel(priority: { carriedFrom?: string }, lookup: (id: string) => Source | undefined, phaseName: (no: number) => string): string | undefined {
  if (!priority.carriedFrom) return undefined
  const from = carriedFromName(priority, lookup, phaseName)
  return from ? `Carried over from ${from}` : 'Carried over'
}

/** How many awards (not removed) were recorded from this very priority, in the phase it is in. They stay in the Log when the priority is removed. */
export function awardsRecordedFrom(priority: { id: string }, awards: { priorityId?: string; status?: unknown }[]): number {
  return awards.filter((award) => award.priorityId === priority.id && award.status !== 'removed').length
}
