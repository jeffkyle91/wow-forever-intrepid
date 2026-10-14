import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore'
import { auth, db, firebaseConfigured, guildId } from './firebase'
import type { JoinRequestRecord, MembershipRecord } from './guildApi'

export type GuildSessionStatus = 'unconfigured' | 'loading' | 'signed-out' | 'request-access' | 'pending' | 'rejected' | 'active' | 'error'

// A snapshot of a missing document that came only from the local cache means the server has not answered yet (offline or unreachable), not that the document does not exist.
const notReached = (snapshot: DocumentSnapshot) => snapshot.metadata.fromCache && !snapshot.exists()

// The SDK also delivers such a cached snapshot on a healthy connection when the same user's listeners are created again (signing out and back in, "Try again"); the server's answer follows within a round trip. Only a wait that lasts is reported as offline.
const OFFLINE_NOTICE_DELAY_MS = 2000

export function useGuildSession() {
  const [user, setUser] = useState<User | null>(null)
  const [membership, setMembership] = useState<MembershipRecord | null>(null)
  const [joinRequest, setJoinRequest] = useState<JoinRequestRecord | null>(null)
  const [status, setStatus] = useState<GuildSessionStatus>(firebaseConfigured ? 'loading' : 'unconfigured')
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (!firebaseConfigured || !auth || !db) return
    const firestore = db

    let current = true
    let unsubscribeMembership = () => {}
    let unsubscribeRequest = () => {}
    let offlineTimer: ReturnType<typeof setTimeout> | undefined
    const stopOfflineTimer = () => { clearTimeout(offlineTimer); offlineTimer = undefined }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      unsubscribeMembership()
      unsubscribeRequest()
      stopOfflineTimer()
      if (!current) return
      setUser(currentUser)
      setMembership(null)
      setJoinRequest(null)
      setError('')
      setOffline(false)

      if (!currentUser) {
        setStatus('signed-out')
        return
      }

      setStatus('loading')
      let membershipLoaded = false
      let requestLoaded = false
      let membershipWaiting = false
      let requestWaiting = false
      let hasMembership = false
      let currentRequest: JoinRequestRecord | null = null
      const updateStatus = () => {
        if (hasMembership) setStatus('active')
        else if (membershipLoaded && requestLoaded) setStatus(currentRequest?.status === 'pending' ? 'pending' : currentRequest?.status === 'rejected' ? 'rejected' : 'request-access')
        const waiting = !hasMembership && !(membershipLoaded && requestLoaded) && (membershipWaiting || requestWaiting)
        if (!waiting) { stopOfflineTimer(); setOffline(false) }
        else if (offlineTimer === undefined) offlineTimer = setTimeout(() => { if (current) setOffline(true) }, OFFLINE_NOTICE_DELAY_MS)
      }
      const onError = () => {
        if (!current) return
        setError('Could not load your guild access. Check the Firebase project settings and security rules.')
        setStatus('error')
      }
      // includeMetadataChanges delivers the later "now confirmed by the server" snapshot even when the document is still missing; without it a genuinely new user would wait on "loading" forever.
      unsubscribeMembership = onSnapshot(doc(firestore, 'guilds', guildId, 'members', currentUser.uid), { includeMetadataChanges: true }, (snapshot) => {
        if (!current) return
        membershipWaiting = notReached(snapshot)
        if (membershipWaiting) { updateStatus(); return }
        membershipLoaded = true
        hasMembership = snapshot.exists()
        setMembership(snapshot.exists() ? ({ ...snapshot.data(), id: snapshot.id } as MembershipRecord) : null)
        updateStatus()
      }, onError)
      unsubscribeRequest = onSnapshot(doc(firestore, 'guilds', guildId, 'joinRequests', currentUser.uid), { includeMetadataChanges: true }, (snapshot) => {
        if (!current) return
        requestWaiting = notReached(snapshot)
        if (requestWaiting) { updateStatus(); return }
        requestLoaded = true
        currentRequest = snapshot.exists() ? ({ ...snapshot.data(), id: snapshot.id } as JoinRequestRecord) : null
        setJoinRequest(currentRequest)
        updateStatus()
      }, onError)
    })

    return () => {
      current = false
      stopOfflineTimer()
      unsubscribeMembership()
      unsubscribeRequest()
      unsubscribe()
    }
  }, [])

  return { user, membership, joinRequest, status, error, setError, offline }
}
