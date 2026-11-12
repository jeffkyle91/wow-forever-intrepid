import { useEffect, useState } from 'react'
import { subscribeGuildCollection } from '../../guildApi'
import { normalizeRosterRaiderType, type RosterRaiderType } from './raiderTypes'

type Feed = { uid: string; records: RosterRaiderType[]; loading: boolean; error: string }

export function useRosterRaiderTypes(uid: string): Feed {
  const [feed, setFeed] = useState<Feed | null>(null)

  useEffect(() => {
    if (!uid) return
    let active = true
    const unsubscribe = subscribeGuildCollection<RosterRaiderType>('raiderTypes', (records, dropped) => {
      if (active) setFeed({ uid, records, loading: false, error: dropped ? 'Some raider type records could not be read. Ask a Guild Leader to check them.' : '' })
    }, (error) => {
      if (active) setFeed({ uid, records: [], loading: false, error: `Could not load raider types: ${error.message}` })
    }, normalizeRosterRaiderType)
    return () => { active = false; unsubscribe() }
  }, [uid])

  return feed?.uid === uid ? feed : { uid, records: [], loading: true, error: '' }
}
