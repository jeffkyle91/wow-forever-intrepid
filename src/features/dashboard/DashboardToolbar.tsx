import { useEffect, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { HelpPopover } from '../../shared/ui/HelpPopover'
import { saveMyRaiderType, subscribeMyRaiderType, type RaiderType } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { findMyCharacters } from './myCharacters'

const TYPES: { type: RaiderType; label: string; hint: string }[] = [
  { type: 'casual', label: 'Casual', hint: 'Not looking to push myself and have lower priority for raid spots.' },
  { type: 'hardcore', label: 'Hardcore', hint: 'Want to push myself and be more involved.' },
]

export function DashboardToolbar({ ctx }: { ctx: TabContext }) {
  const { uid } = ctx.identity
  const { busy, setBusy, setMutationError, setNotice } = ctx.feedback
  const [current, setCurrent] = useState<RaiderType | null>(null)

  useEffect(() => {
    if (!uid) return undefined
    return subscribeMyRaiderType(uid, setCurrent, (error) => setMutationError(error.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setMutationError comes from a ctx rebuilt on every render
  }, [uid])

  if (!findMyCharacters(ctx.data.roster, uid).linked) return null

  async function choose(type: RaiderType) {
    if (type === current) return
    setBusy(true)
    try {
      await saveMyRaiderType(uid, type)
      setMutationError('')
      setNotice('Raider type updated.')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not update raider type.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="dash-head">
    <div className="dash-raider-type" role="group" aria-label="Raider type">
      {TYPES.map((option) => <button key={option.type} aria-pressed={current === option.type} disabled={busy} onClick={() => choose(option.type)}>{option.label}</button>)}
    </div>
    <HelpPopover label="About Casual and Hardcore" trigger={<CircleHelp size={16} />}>
      {TYPES.map((option) => <p key={option.type}><strong>{option.label}:</strong> {option.hint}</p>)}
      <p>Reading this help does not change your raider type.</p>
    </HelpPopover>
    <HelpPopover label="About attendance" triggerClassName="dash-attendance-chip" trigger={<>Attendance <strong>--</strong></>}><p>Attendance tracking is coming.</p></HelpPopover>
  </div>
}
