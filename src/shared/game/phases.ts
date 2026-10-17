// Structural types, so this file has no imports and Node can run its tests directly. GuildSettings (guildApi.ts) satisfies PhaseSettings.

// Phases of the loot lists. A phase is a number, not a name, so renaming one in Settings can never split its lists.
//
// Settings keep the name of the current phase (`currentPhase`), the name of the next one (`nextPhase`) and the names of the finished
// ones, oldest first (`phaseHistory`). The number of the current phase is the length of that list; a guild that has never closed a
// phase is in phase 0. A priority or an award carries `phaseNo`; none means phase 0, so everything recorded before phases existed
// belongs to the first phase and nothing has to be migrated. Past phases are read-only. The next phase can be prepared ahead of time.

export const PHASE_HISTORY_MAX = 30

export type PhaseSettings = { currentPhase: string; nextPhase: string; phaseHistory?: string[] }
export type PhaseKind = 'past' | 'current' | 'next'
export type PhaseOption = { no: number; name: string; kind: PhaseKind }

// A whole number of 0 or more. Anything else, including a number stored as text, is not a phase.
export const isPhaseNo = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

// The phase a priority or an award belongs to.
export const phaseNoOf = (record: { phaseNo?: unknown }) => (isPhaseNo(record.phaseNo) ? record.phaseNo : 0)

// The finished phases, oldest first, as stored in Settings. Their count is the number of the current phase, so an entry that cannot be read
// keeps its place under a placeholder name instead of being dropped. A history that is missing, empty or not a list gives undefined.
export function readPhaseHistory(value: unknown, readName: (entry: unknown, fallback: string) => string): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  return value.slice(0, PHASE_HISTORY_MAX).map((entry, index) => readName(entry, `Phase ${index + 1}`))
}

// A copy of a priority or award without a phaseNo or carriedFrom that cannot be trusted (see the normalizers in shared/lib/normalize.ts).
export function withoutBadPhaseFields<T extends object>(record: T): T {
  const clean: T & { phaseNo?: unknown; carriedFrom?: unknown } = { ...record }
  if (clean.phaseNo !== undefined && !isPhaseNo(clean.phaseNo)) delete clean.phaseNo
  if (clean.carriedFrom !== undefined && !(typeof clean.carriedFrom === 'string' && clean.carriedFrom !== '')) delete clean.carriedFrom
  return clean
}

export const currentPhaseNo = (settings: Partial<PhaseSettings>) => settings.phaseHistory?.length ?? 0

// Every phase that can be looked at, newest first: the next one (only when asked for), the current one, then the finished ones.
export function phaseOptions(settings: PhaseSettings, includeNext: boolean): PhaseOption[] {
  const current = currentPhaseNo(settings)
  const history = settings.phaseHistory ?? []
  return [
    ...(includeNext ? [{ no: current + 1, name: settings.nextPhase, kind: 'next' as const }] : []),
    { no: current, name: settings.currentPhase, kind: 'current' as const },
    ...history.map((name, no) => ({ no, name, kind: 'past' as const })).reverse(),
  ]
}

// The phase to show: the one asked for, or the current phase when none was asked for or the one asked for is not available.
export function viewedPhase(settings: PhaseSettings, wanted: number | null, includeNext: boolean): PhaseOption {
  const options = phaseOptions(settings, includeNext)
  return options.find((option) => option.no === wanted) ?? options.find((option) => option.kind === 'current')!
}

export const phaseLabel = (option: PhaseOption) => (option.kind === 'past' ? option.name : `${option.name} (${option.kind})`)
