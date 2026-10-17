import { useState } from 'react'
import { saveGuildSettings } from '../../guildApi'
import { NEXT_PHASE_PLACEHOLDER, currentPhaseNo, phaseNoOf, reopenPhase, reopenProblem, startNextPhase, startPhaseProblem } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { setPriorityFilters } from './priorityFilters'
import './Phases.css'

// Guild Leaders only (the rules let nobody else write the settings). Starting a phase closes the current one: its lists become a read-only
// record, and the lists already prepared for the next phase become the current ones. Reopening undoes it while nothing was awarded yet.
// Both are one save of the settings document; no priority or award is rewritten.
export function PhasesModal({ close, live }: { close: () => void; live: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = live.feedback
  const { settings, allPriorities, awards } = live.data
  const [name, setName] = useState(settings.nextPhase === NEXT_PHASE_PLACEHOLDER ? '' : settings.nextPhase)
  const [confirming, setConfirming] = useState<'start' | 'reopen' | null>(null)

  const current = currentPhaseNo(settings)
  const finished = settings.phaseHistory ?? []
  const prepared = allPriorities.filter((priority) => phaseNoOf(priority) === current + 1).length
  const nameProblem = startPhaseProblem(settings, name)
  const reopenBlocked = reopenProblem(settings, awards, allPriorities)

  async function save(next: typeof settings, done: string) {
    setBusy(true)
    try {
      await saveGuildSettings(next)
      setPriorityFilters({ phase: null })
      setMutationError('')
      setNotice(done)
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not save the phase.')
      setConfirming(null)
    } finally {
      setBusy(false)
    }
  }

  const start = () => save(startNextPhase(settings, name), `${name.trim()} has started. ${settings.currentPhase} is now a read-only record.`)
  const reopen = () => save(reopenPhase(settings), `${finished[finished.length - 1]} is the current phase again.`)

  return <Modal title="Phases" onClose={close}>
    <div className="phases-summary">
      <p><strong>Current phase:</strong> {settings.currentPhase}</p>
      <p><strong>Next phase:</strong> {settings.nextPhase}{prepared > 0 && <> ({prepared} {prepared === 1 ? 'priority' : 'priorities'} prepared)</>}</p>
      <p><strong>Finished:</strong> {finished.length ? [...finished].reverse().join(', ') : 'none yet'}</p>
    </div>

    <section className="phases-section">
      <h3>Start the next phase</h3>
      <p>{settings.currentPhase} closes and its lists become a read-only record. {prepared > 0 ? `The ${prepared} ${prepared === 1 ? 'priority' : 'priorities'} prepared for the next phase become the current lists.` : 'The new phase starts with empty lists.'} Its status reads Active; change the status label and color in Settings.</p>
      <label className="phases-name">Name of the new phase
        <input value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setConfirming(null) }} placeholder="e.g. Phase 2" disabled={busy} aria-invalid={!!nameProblem && !!name.trim()} />
      </label>
      {name.trim() && nameProblem && <p className="phases-problem" role="alert">{nameProblem}</p>}
      {confirming === 'start'
        ? <div className="phases-confirm" role="alert"><span>Close {settings.currentPhase} and start {name.trim()}?</span><button type="button" className="button button-secondary" onClick={() => setConfirming(null)} disabled={busy}>Back</button><button type="button" className="button button-primary" onClick={start} disabled={busy}>Yes, start {name.trim()}</button></div>
        : <button type="button" className="button button-primary" onClick={() => setConfirming('start')} disabled={busy || !!nameProblem}>Start {name.trim() || 'the next phase'}</button>}
    </section>

    {finished.length > 0 && <section className="phases-section">
      <h3>Started by mistake?</h3>
      <p>Reopening makes {finished[finished.length - 1]} the current phase again, and {settings.currentPhase} the next one with its lists kept. It is only possible while nothing has been awarded in {settings.currentPhase}.</p>
      {reopenBlocked && <p className="phases-problem">{reopenBlocked}</p>}
      {confirming === 'reopen'
        ? <div className="phases-confirm" role="alert"><span>Reopen {finished[finished.length - 1]}?</span><button type="button" className="button button-secondary" onClick={() => setConfirming(null)} disabled={busy}>Back</button><button type="button" className="button button-primary" onClick={reopen} disabled={busy}>Yes, reopen it</button></div>
        : <button type="button" className="button button-secondary" onClick={() => setConfirming('reopen')} disabled={busy || !!reopenBlocked}>Reopen {finished[finished.length - 1]}</button>}
    </section>}
  </Modal>
}
