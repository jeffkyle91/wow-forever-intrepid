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

// The name of a phase by number: a finished phase's name from the history, the current and next phase's from the settings. A number nothing
// names (an entry from before the history was edited, say) reads as "Phase <n>".
export function phaseName(settings: PhaseSettings, no: number): string {
  const options = phaseOptions(settings, true)
  return options.find((option) => option.no === no)?.name ?? `Phase ${no}`
}

export const phaseLabel = (option: PhaseOption) => (option.kind === 'past' ? option.name : `${option.name} (${option.kind})`)

// Starting and reopening a phase. Both are one save of the settings document, so nothing about a priority or an award changes: the lists of
// the next phase are already filed under the number that becomes the current one. The rules (validPhaseHistory) accept exactly these two moves.

export const NEXT_PHASE_PLACEHOLDER = 'To be announced'
export const PHASE_NAME_MAX = 40

type PhaseStatus = { currentStatusLabel: string; currentStatusTone: string; nextStatusLabel: string; nextStatusTone: string }
export type RollableSettings = PhaseSettings & PhaseStatus

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

// Why a name cannot be the next phase's, or undefined when it can. A name already used is refused so two phases never look alike in the list.
export function startPhaseProblem(settings: PhaseSettings, name: string): string | undefined {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter a name for the new phase.'
  if (trimmed.length > PHASE_NAME_MAX) return `A phase name can be up to ${PHASE_NAME_MAX} characters.`
  if (sameName(trimmed, NEXT_PHASE_PLACEHOLDER)) return `Give the phase a real name, not "${NEXT_PHASE_PLACEHOLDER}".`
  if ([settings.currentPhase, ...(settings.phaseHistory ?? [])].some((used) => sameName(used, trimmed))) return 'A phase with this name already exists.'
  if ((settings.phaseHistory?.length ?? 0) >= PHASE_HISTORY_MAX) return `A guild can have up to ${PHASE_HISTORY_MAX} finished phases.`
  return undefined
}

// The settings after the current phase closes: its name goes on the end of the history, the new name becomes current and Active, and the
// next phase is blank again. A leader can change the status label and color in Settings.
export function startNextPhase<T extends RollableSettings>(settings: T, name: string): T {
  return {
    ...settings,
    phaseHistory: [...(settings.phaseHistory ?? []), settings.currentPhase],
    currentPhase: name.trim(),
    nextPhase: NEXT_PHASE_PLACEHOLDER,
    currentStatusLabel: 'Active',
    currentStatusTone: 'active',
    nextStatusLabel: 'Not started',
    nextStatusTone: 'paused',
  }
}

// The settings after the last finished phase is reopened: its name is current again and the phase being left is the next one. The current
// status stays as it is (the reopened phase is live) and the next phase's status is blank. A history that becomes empty is left out.
export function reopenPhase<T extends RollableSettings>(settings: T): T {
  const history = settings.phaseHistory ?? []
  const { phaseHistory: _dropped, ...rest } = settings
  return {
    ...rest,
    ...(history.length > 1 ? { phaseHistory: history.slice(0, -1) } : {}),
    currentPhase: history[history.length - 1],
    nextPhase: settings.currentPhase,
    nextStatusLabel: 'Not started',
    nextStatusTone: 'paused',
  } as T
}

// Why the last phase cannot be reopened, or undefined when it can. Awards recorded in the current phase would end up in the next one, and a
// list prepared for the phase after the next would end up two phases ahead, where nothing can reach it.
export function reopenProblem(settings: PhaseSettings, awards: { phaseNo?: unknown }[], priorities: { phaseNo?: unknown }[]): string | undefined {
  const current = currentPhaseNo(settings)
  if (current === 0) return 'There is no finished phase to reopen.'
  if (awards.some((award) => phaseNoOf(award) === current)) return `Loot has been awarded in ${settings.currentPhase}, so it cannot be undone.`
  if (priorities.some((priority) => phaseNoOf(priority) > current)) return `A list has been prepared for the phase after ${settings.currentPhase}. Remove it first.`
  return undefined
}
