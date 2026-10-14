import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db, firebaseConfigured, guildId } from './firebase'
import type { JoinRequestRecord, MembershipRecord } from './guildApi'

export type GuildSessionStatus = 'unconfigured' | 'loading' | 'signed-out' | 'request-access' | 'pending' | 'rejected' | 'active' | 'error'

export function useGuildSession() {
  const [user, setUser] = useState<User | null>(null)
  const [membership, setMembership] = useState<MembershipRecord | null>(null)
  const [joinRequest, setJoinRequest] = useState<JoinRequestRecord | null>(null)
  const [status, setStatus] = useState<GuildSessionStatus>(firebaseConfigured ? 'loading' : 'unconfigured')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!firebaseConfigured || !auth || !db) return
    const firestore = db

    let current = true
    let unsubscribeMembership = () => {}
    let unsubscribeRequest = () => {}
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      unsubscribeMembership()
      unsubscribeRequest()
      if (!current) return
      setUser(currentUser)
      setMembership(null)
      setJoinRequest(null)
      setError('')

      if (!currentUser) {
        setStatus('signed-out')
        return
      }

      setStatus('loading')
      let membershipLoaded = false
      let requestLoaded = false
      let hasMembership = false
      let currentRequest: JoinRequestRecord | null = null
      const updateStatus = () => {
        if (hasMembership) setStatus('active')
        else if (membershipLoaded && requestLoaded) setStatus(currentRequest?.status === 'pending' ? 'pending' : currentRequest?.status === 'rejected' ? 'rejected' : 'request-access')
      }
      const onError = () => {
        if (!current) return
        setError('Could not load your guild access. Check the Firebase project settings and security rules.')
        setStatus('error')
      }
      unsubscribeMembership = onSnapshot(doc(firestore, 'guilds', guildId, 'members', currentUser.uid), (snapshot) => {
        if (!current) return
        membershipLoaded = true
        hasMembership = snapshot.exists()
        setMembership(snapshot.exists() ? ({ ...snapshot.data(), id: snapshot.id } as MembershipRecord) : null)
        updateStatus()
      }, onError)
      unsubscribeRequest = onSnapshot(doc(firestore, 'guilds', guildId, 'joinRequests', currentUser.uid), (snapshot) => {
        if (!current) return
        requestLoaded = true
        currentRequest = snapshot.exists() ? ({ ...snapshot.data(), id: snapshot.id } as JoinRequestRecord) : null
        setJoinRequest(currentRequest)
        updateStatus()
      }, onError)
    })

    return () => {
      current = false
      unsubscribeMembership()
      unsubscribeRequest()
      unsubscribe()
    }
  }, [])

  return { user, membership, joinRequest, status, error, setError }
}
