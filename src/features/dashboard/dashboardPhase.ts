import { currentPhaseNo, phaseOptions, viewedPhase, type PhaseOption, type PhaseSettings } from '../../shared/game/phases.ts'

// My dashboard's phase choice (MEMBER-008). It remembers which phase was current when it was made, so it ends when the guild starts the next phase and the
// dashboard goes back to the phase the guild is in. Pure.
export type PhaseChoice = { no: number; whenCurrent: number }

// The phases a member can look at: the current one and the finished ones, newest first. The next phase is for leaders to prepare.
export const dashboardPhases = (settings: PhaseSettings): PhaseOption[] => phaseOptions(settings, false)

// The phase to show: the choice while it still stands, otherwise the current phase. A choice that is not offered (the next phase, or one that does not exist) gives the current phase too.
export function shownPhase(settings: PhaseSettings, choice: PhaseChoice | null): PhaseOption {
  return viewedPhase(settings, choice && choice.whenCurrent === currentPhaseNo(settings) ? choice.no : null, false)
}
