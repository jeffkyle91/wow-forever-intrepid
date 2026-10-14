import { createAfkEntry, deleteAfkEntry } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { AfkCalendar } from './AfkCalendar'

export function CalendarTab({ ctx }: { ctx: TabContext }) {
  const { roster, afkEntries, raids } = ctx.data
  const { busy, setBusy, setMutationError, setNotice } = ctx.feedback

  async function addAfkEntry(startDate: string, endDate: string) {
    if (!ctx.identity.uid) return false
    setBusy(true)
    try {
      await createAfkEntry({ userId: ctx.identity.uid, displayName: ctx.identity.displayName, startDate, endDate })
      setMutationError('')
      setNotice('Unavailable dates added.')
      return true
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not add unavailable dates.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function removeAfkEntry(entryId: string) {
    setBusy(true)
    try {
      await deleteAfkEntry(entryId)
      setMutationError('')
      setNotice('Unavailable dates removed.')
      return true
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not remove unavailable dates.')
      return false
    } finally {
      setBusy(false)
    }
  }

  return <AfkCalendar entries={afkEntries} raids={raids} roster={roster} currentUserId={ctx.identity.uid} busy={busy} onAdd={addAfkEntry} onRemove={removeAfkEntry} />
}
