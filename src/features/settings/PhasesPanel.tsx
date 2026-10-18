import { useState } from 'react'
import { changePhase } from '../../guildApi'
import { currentPhaseNo, matchesPhrase, phaseName, phaseNoOf, reopenPhase, reopenProblem, startNextPhase, startPhaseProblem, startPhrase } from '../../shared/game/phases'
import { describePreparedTables } from '../../shared/game/guildTables'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import './Phases.css'

// Starting a loot phase, and taking it back. Guild Leaders only (this tab is, and the rules let nobody else write the settings). Starting
// closes the current phase: its loot priorities become a read-only record, and the lists already prepared for the next phase become the
// current ones, and the drop lists of Browse drops are the ones prepared for the next phase (they belong to a phase too: a phase starts with no zones
// unless it follows an earlier one, see shared/game/guildTables.ts). The names are the Current phase and Next phase above, as saved. Starting and reopening are each one save of the settings
// document with its entry in the Log; no priority or award is rewritten.
export function PhasesPanel({ ctx }: { ctx: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = ctx.feedback
  const { settings, allPriorities, awards, lootTables } = ctx.data
  const [reopening, setReopening] = useState(false)

  const finished = settings.phaseHistory ?? []
  const last = finished[finished.length - 1]
  const prepared = allPriorities.filter((priority) => phaseNoOf(priority) === currentPhaseNo(settings) + 1).length
  const preparedLists = describePreparedTables(lootTables, currentPhaseNo(settings) + 1, (no) => phaseName(settings, no))
  const problem = startPhaseProblem(settings, settings.nextPhase)
  const reopenBlocked = reopenProblem(settings, awards, allPriorities)

  async function reopen() {
    setBusy(true)
    try {
      await changePhase(reopenPhase(settings), 'reopen', { uid: ctx.identity.uid, displayName: ctx.identity.displayName })
      setMutationError('')
      setNotice(`${last} is the current phase again.`)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not reopen the phase.')
    } finally {
      setBusy(false)
      setReopening(false)
    }
  }

  return <section className="settings-section phases-panel">
    <header>
      <h3>Loot phases</h3>
      <p>Starting a phase closes the current one: its loot priorities become a read-only record, and the lists already prepared for the next phase become the current ones. The drop lists of Browse drops become the ones prepared for the next phase: it starts with no zones unless a leader ticked some or made it follow an earlier phase (Edit the drop lists). The names are the Current phase and Next phase above (save them first). Every start is in the Log on Loot priorities.</p>
    </header>
    <dl className="phases-summary">
      <div><dt>Current phase</dt><dd>{settings.currentPhase}</dd></div>
      <div><dt>Next phase</dt><dd>{settings.nextPhase}{prepared > 0 ? ` (${prepared} ${prepared === 1 ? 'priority' : 'priorities'} prepared)` : ''}</dd></div>
      <div><dt>Drop lists</dt><dd>{preparedLists ? `Prepared for ${settings.nextPhase}: ${preparedLists}.` : `Nothing prepared for ${settings.nextPhase} yet. It starts with no zones until a leader chooses them.`}</dd></div>
      <div><dt>Finished</dt><dd>{finished.length ? [...finished].reverse().join(', ') : 'none yet'}</dd></div>
    </dl>
    {problem && <p className="phases-hint" role="note">{problem} Change the Next phase above and save it to start it.</p>}
    <div className="phases-actions">
      <button type="button" className="button button-primary" disabled={busy || !!problem} onClick={() => ctx.openModal(({ close, live }) => <StartPhaseModal close={close} live={live} />)}>{problem ? 'Start the next phase' : startPhrase(settings.nextPhase)}</button>
    </div>
    {finished.length > 0 && <div className="phases-undo">
      <h4>Started by mistake?</h4>
      <p>Reopening makes {last} the current phase again, and {settings.currentPhase} the next one with its lists kept. It is only possible while nothing has been awarded in {settings.currentPhase}. Drop list changes already written for {settings.currentPhase} stay stored and apply again when it starts.</p>
      {reopenBlocked && <p className="phases-hint" role="note">{reopenBlocked}</p>}
      {reopening
        ? <div className="phases-confirm" role="alert"><span>Reopen {last}?</span><button type="button" className="button button-secondary" onClick={() => setReopening(false)} disabled={busy}>Back</button><button type="button" className="button button-primary" onClick={() => void reopen()} disabled={busy}>Yes, reopen it</button></div>
        : <button type="button" className="button button-secondary" disabled={busy || !!reopenBlocked} onClick={() => setReopening(true)}>Reopen {last}</button>}
    </div>}
  </section>
}

// One more step before a phase starts: the Guild Leader types the words, so it cannot be done by a stray click.
function StartPhaseModal({ close, live }: { close: () => void; live: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = live.feedback
  const { settings, allPriorities, lootTables } = live.data
  const [typed, setTyped] = useState('')
  const name = settings.nextPhase
  const phrase = startPhrase(name)
  const prepared = allPriorities.filter((priority) => phaseNoOf(priority) === currentPhaseNo(settings) + 1).length
  const preparedLists = describePreparedTables(lootTables, currentPhaseNo(settings) + 1, (no) => phaseName(settings, no))
  const ready = matchesPhrase(typed, phrase) && !startPhaseProblem(settings, name)

  async function start() {
    if (!ready) return
    setBusy(true)
    try {
      await changePhase(startNextPhase(settings, name), 'start', { uid: live.identity.uid, displayName: live.identity.displayName })
      setMutationError('')
      setNotice(`${name} has started. ${settings.currentPhase} is now a read-only record.`)
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not start the phase.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={`${phrase}?`} onClose={close}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void start() }}>
    <p className="phases-warning"><strong>{settings.currentPhase}</strong> closes now: its loot priorities become a read-only record. {prepared > 0 ? (prepared === 1 ? `The 1 priority prepared for ${name} becomes the current list.` : `The ${prepared} priorities prepared for ${name} become the current lists.`) : `${name} starts with no priorities.`} {preparedLists ? `The drop lists of ${name} are the ones prepared for it (it ${preparedLists}).` : `Nothing is prepared for the drop lists of ${name}: Browse drops will show no zones until a leader chooses them in Edit the drop lists.`} Starting is logged and can be undone only until something is awarded in {name}.</p>
    <label>Type <strong>{phrase}</strong> to confirm<input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus autoComplete="off" spellCheck={false} aria-label={`Type ${phrase} to confirm`} /></label>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy || !ready}>{phrase}</button></div>
  </form></Modal>
}
