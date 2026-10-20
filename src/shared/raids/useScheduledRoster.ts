import { useEffect, useState } from 'react'
import { subscribeScheduledRoster } from '../../scheduledRaids'
import type { ScheduledRoster } from './planning'

export function useScheduledRoster(raidId: string) {
  const [state, setState] = useState<{ raidId: string; roster: ScheduledRoster | null; loaded: boolean; error: string }>({ raidId, roster: null, loaded: false, error: '' })
  const [retry, setRetry] = useState(0)
  useEffect(() => subscribeScheduledRoster(raidId, (roster) => setState({ raidId, roster, loaded: true, error: '' }),
    (failure) => setState({ raidId, roster: null, loaded: false, error: failure.message })), [raidId, retry])
  return {
    roster: state.raidId === raidId ? state.roster : null,
    loaded: state.raidId === raidId && state.loaded,
    error: state.raidId === raidId ? state.error : '',
    retry: () => setRetry((value) => value + 1),
  }
}
