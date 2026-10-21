import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db, guildId } from '../../firebase'
import type { RaidRecord } from '../../guildApi'
import {
  buildSnapshotInvitationRows,
  buildSnapshotReportRoster,
  buildSnapshotReports,
  readSnapshotAccount,
  readSnapshotCharacter,
  readSnapshotLineup,
  readSnapshotManifest,
  sortSnapshotReports,
  SnapshotDataError,
  type SnapshotCharacter,
  type SnapshotInvitationRow,
  type SnapshotReport,
  type SnapshotReportRoster,
} from './history'

type RaidMetadata = { reports: SnapshotReport[] } | { reports: []; error: string }
type HistoryState = { reports: SnapshotReport[]; errors: string[]; raidIdsKey: string; refreshVersion: number }

function firestoreErrorMessage(error: unknown, fallback: string) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === 'permission-denied') return 'You do not have permission to read this published raid history.'
  if (error instanceof SnapshotDataError) return error.message
  return fallback
}

function requireFirestore() {
  if (!db || !guildId) throw new Error('Guild Firestore is not configured.')
  return db
}

async function raidMetadata(raidId: string): Promise<RaidMetadata> {
  const database = requireFirestore()
  const snapshots = await getDocs(query(
    collection(database, 'guilds', guildId, 'raids', raidId, 'snapshots'),
    where('status', '==', 'complete'),
  ))
  if (snapshots.empty) return { reports: [] }
  if (snapshots.size !== 1 || snapshots.docs[0].id !== 'start') {
    throw new SnapshotDataError(`Raid ${raidId} has unexpected published snapshot records.`)
  }
  const snapshot = snapshots.docs[0]
  const manifest = readSnapshotManifest(raidId, snapshot.data())
  const lineups = await Promise.all(manifest.lineupSizes.map(async (size) => {
    const lineup = await getDoc(doc(database, 'guilds', guildId, 'raids', raidId, 'snapshots', 'start', 'lineups', String(size)))
    if (!lineup.exists()) throw new SnapshotDataError(`Published ${size}M lineup is missing from raid ${raidId}.`)
    return readSnapshotLineup(size, lineup.data())
  }))
  const snapshotPath = `guilds/${guildId}/raids/${raidId}/snapshots/start`
  return { reports: buildSnapshotReports(snapshotPath, manifest, lineups) }
}

export function useRaidHistory(raids: RaidRecord[], raidsLoaded: boolean) {
  const [state, setState] = useState<HistoryState>({ reports: [], errors: [], raidIdsKey: '', refreshVersion: -1 })
  const [refreshVersion, setRefreshVersion] = useState(0)
  const metadataCache = useRef(new Map<string, RaidMetadata>())
  const characterCache = useRef(new Map<string, Promise<SnapshotCharacter>>())
  const rosterCache = useRef(new Map<string, Promise<SnapshotReportRoster>>())
  const invitationCache = useRef(new Map<string, Promise<SnapshotInvitationRow[]>>())
  const raidIds = useMemo(() => [...new Set(raids.map(({ id }) => id))].sort(), [raids])
  const raidIdsKey = raidIds.join('\u0000')

  useEffect(() => {
    if (!raidsLoaded) return
    let cancelled = false
    const ids = raidIdsKey ? raidIdsKey.split('\u0000') : []
    const discover = async () => {
      const missing = ids.filter((id) => !metadataCache.current.has(id))
      for (let index = 0; index < missing.length; index += 8) {
        await Promise.all(missing.slice(index, index + 8).map(async (raidId) => {
          try {
            metadataCache.current.set(raidId, await raidMetadata(raidId))
          } catch (error) {
            metadataCache.current.set(raidId, {
              reports: [],
              error: firestoreErrorMessage(error, `Could not load the published snapshot for raid ${raidId}.`),
            })
          }
        }))
      }
      if (cancelled) return
      const entries = ids.map((id) => metadataCache.current.get(id)).filter((entry): entry is RaidMetadata => Boolean(entry))
      setState({
        reports: sortSnapshotReports(entries.flatMap((entry) => entry.reports)),
        errors: entries.flatMap((entry) => 'error' in entry ? [entry.error] : []),
        raidIdsKey,
        refreshVersion,
      })
    }
    void discover()
    return () => { cancelled = true }
  }, [raidIdsKey, raidsLoaded, refreshVersion])

  const loadCharacters = useCallback(async (snapshotPath: string, ids: string[]) => {
    const database = requireFirestore()
    return Promise.all([...new Set(ids)].map((id) => {
      const key = `${snapshotPath}/characters/${id}`
      let pending = characterCache.current.get(key)
      if (!pending) {
        pending = getDoc(doc(database, snapshotPath, 'characters', id)).then((snapshot) => {
          if (!snapshot.exists()) throw new SnapshotDataError(`Snapshot character ${id} is missing.`)
          return readSnapshotCharacter(id, snapshot.data())
        }).catch((error) => {
          characterCache.current.delete(key)
          throw error
        })
        characterCache.current.set(key, pending)
      }
      return pending
    }))
  }, [])

  const loadReport = useCallback((report: SnapshotReport) => {
    const cached = rosterCache.current.get(report.id)
    if (cached) return cached
    const pending = loadCharacters(report.snapshotPath, [...report.characterIds, ...report.benchIds])
      .then((characters) => buildSnapshotReportRoster(report, new Map(characters.map((character) => [character.id, character]))))
      .catch((error) => {
        rosterCache.current.delete(report.id)
        throw error
      })
    rosterCache.current.set(report.id, pending)
    return pending
  }, [loadCharacters])

  const loadInvitations = useCallback((report: SnapshotReport) => {
    const cached = invitationCache.current.get(report.snapshotPath)
    if (cached) return cached
    const pending = (async () => {
      const database = requireFirestore()
      const accountsSnapshot = await getDocs(collection(database, report.snapshotPath, 'accounts'))
      if (accountsSnapshot.size !== report.expectedAccountCount) {
        throw new SnapshotDataError('The published snapshot invitation/sign-up records are incomplete.')
      }
      const accounts = accountsSnapshot.docs.map((entry) => readSnapshotAccount(entry.id, entry.data()))
      const characters = await loadCharacters(report.snapshotPath, accounts.flatMap((account) => [
        ...(account.invitationMainId ? [account.invitationMainId] : []),
        ...(account.signup ? [account.signup.characterId] : []),
      ]))
      return buildSnapshotInvitationRows(accounts, new Map(characters.map((character) => [character.id, character])))
    })().catch((error) => {
      invitationCache.current.delete(report.snapshotPath)
      throw error
    })
    invitationCache.current.set(report.snapshotPath, pending)
    return pending
  }, [loadCharacters])

  const refresh = useCallback(() => {
    metadataCache.current.clear()
    setRefreshVersion((current) => current + 1)
  }, [])

  const isCurrent = state.raidIdsKey === raidIdsKey && state.refreshVersion === refreshVersion
  return {
    reports: isCurrent ? state.reports : [],
    errors: isCurrent ? state.errors : [],
    loading: raidsLoaded && !isCurrent,
    loadReport,
    loadInvitations,
    refresh,
  }
}
