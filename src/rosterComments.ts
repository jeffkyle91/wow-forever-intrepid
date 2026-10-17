import { useEffect, useState } from 'react'
import { subscribeGuildCollection } from './guildApi'
import type { GuildRole } from './security'
import { auth } from './firebase'

export type RosterComment = { id: string; text: string }
export type CommentFeed = { records: RosterComment[]; loading: boolean; error: string }
const initialFeed = (): CommentFeed => ({ records: [], loading: true, error: '' })

export function useRosterComments(enabled: boolean, actualRole: GuildRole | null) {
  const uid = auth?.currentUser?.uid ?? null
  const [feeds, setFeeds] = useState<{ uid: string; role: GuildRole | null; public: CommentFeed; leadership: CommentFeed } | null>(null)
  const canReadLeadership = actualRole === 'Guild Leader' || actualRole === 'Raid Leader'

  useEffect(() => {
    if (!enabled || !uid) return
    let active = true
    const subscribe = (audience: 'public' | 'leadership', collection: string) => {
      const update = (feed: CommentFeed) => {
        if (active) setFeeds((current) => ({
          uid,
          role: actualRole,
          public: current?.uid === uid && current.role === actualRole ? current.public : initialFeed(),
          leadership: current?.uid === uid && current.role === actualRole ? current.leadership : initialFeed(),
          [audience]: feed,
        }))
      }
      return subscribeGuildCollection<RosterComment>(collection, (records, dropped) => {
        update({ records, loading: false, error: dropped ? `${dropped} unreadable comment(s) could not be displayed.` : '' })
      }, (error) => update({ records: [], loading: false, error: error.message }), (id, data) =>
        data.userId === id && typeof data.text === 'string' && data.text.trim() ? { id, text: data.text } : null)
    }
    const unsubscribers = [subscribe('public', 'publicComments')]
    if (canReadLeadership) unsubscribers.push(subscribe('leadership', 'leaderComments'))
    return () => {
      active = false
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [enabled, uid, actualRole, canReadLeadership])

  const current = enabled && feeds?.uid === uid && feeds?.role === actualRole ? feeds : null
  return {
    public: current?.public ?? initialFeed(),
    leadership: canReadLeadership ? current?.leadership ?? initialFeed() : null,
  }
}
