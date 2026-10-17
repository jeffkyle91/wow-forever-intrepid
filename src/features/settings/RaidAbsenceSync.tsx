import { synchronizeRaidAbsences } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'

export function RaidAbsenceSync({ ctx }: { ctx: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = ctx.feedback

  async function synchronize() {
    if (busy) return
    setBusy(true)
    try {
      const checked = await synchronizeRaidAbsences()
      setMutationError('')
      setNotice(`Unavailable dates synchronized across ${checked} upcoming raids.`)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not synchronize raid absences.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="settings-section">
    <header><h3>Existing raid absences</h3><p>Run once after enabling server-side sign-ups to apply existing unavailable dates to upcoming raids. Matching responses become Absent. This is safe to repeat and never restores an older response.</p></header>
    <button type="button" className="button button-secondary" disabled={busy} onClick={() => void synchronize()}>Synchronize raid absences</button>
  </section>
}
