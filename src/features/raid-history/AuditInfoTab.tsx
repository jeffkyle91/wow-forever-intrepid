import { useEffect, useState } from 'react'
import { classColorKey } from '../../shared/game/classes'
import { EmptyRow } from '../../shared/ui/EmptyRow'
import type { TabContext } from '../../shared/tabs/types'
import {
  type SnapshotInvitationRow,
  type SnapshotReport,
  type SnapshotReportRoster,
} from './history'
import { useRaidHistory } from './useRaidHistory'

export function AuditInfoTab({ ctx }: { ctx: TabContext }) {
  const { reports, errors, loading, refresh, loadReport, loadInvitations } = useRaidHistory(ctx.data.raids, ctx.data.raidPlanningLoaded)
  const [selectedId, setSelectedId] = useState('')
  const selectedReport = reports.find((report) => report.id === selectedId) ?? reports[0] ?? null
  const [rosterState, setRosterState] = useState<{ reportId: string; roster?: SnapshotReportRoster; error?: string }>({ reportId: '' })
  const [invitationState, setInvitationState] = useState<{
    snapshotPath: string
    rows: SnapshotInvitationRow[] | null
    error: string
    loading: boolean
  }>({ snapshotPath: '', rows: null, error: '', loading: false })
  const [expandedSnapshotPath, setExpandedSnapshotPath] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedReport) return
    let cancelled = false
    void loadReport(selectedReport).then((result) => {
      if (!cancelled) setRosterState({ reportId: selectedReport.id, roster: result })
    }).catch((error: unknown) => {
      if (!cancelled) setRosterState({ reportId: selectedReport.id, error: errorMessage(error, 'Could not load the published roster details.') })
    })
    return () => { cancelled = true }
  }, [loadReport, selectedReport])

  const roster = selectedReport && rosterState.reportId === selectedReport.id ? rosterState.roster ?? null : null
  const rosterError = selectedReport && rosterState.reportId === selectedReport.id ? rosterState.error ?? '' : ''
  const rosterLoading = Boolean(selectedReport && rosterState.reportId !== selectedReport.id)
  const showInvitations = Boolean(selectedReport && expandedSnapshotPath === selectedReport.snapshotPath)
  const currentInvitationState = selectedReport && invitationState.snapshotPath === selectedReport.snapshotPath
    ? invitationState
    : { snapshotPath: selectedReport?.snapshotPath ?? '', rows: null, error: '', loading: false }

  const fetchInvitations = (report: SnapshotReport) => {
    setExpandedSnapshotPath(report.snapshotPath)
    if (invitationState.snapshotPath === report.snapshotPath && (invitationState.loading || invitationState.rows)) return
    setInvitationState({ snapshotPath: report.snapshotPath, rows: null, error: '', loading: true })
    void loadInvitations(report).then((rows) => {
      setInvitationState((current) => current.snapshotPath === report.snapshotPath
        ? { snapshotPath: report.snapshotPath, rows, error: '', loading: false }
        : current)
    }).catch((error: unknown) => {
      setInvitationState((current) => current.snapshotPath === report.snapshotPath
        ? {
          snapshotPath: report.snapshotPath,
          rows: null,
          error: errorMessage(error, 'Could not load the published invitation and sign-up details.'),
          loading: false,
        }
        : current)
    })
  }

  const toggleInvitations = () => {
    if (!selectedReport) return
    if (showInvitations) {
      setExpandedSnapshotPath(null)
      return
    }
    fetchInvitations(selectedReport)
  }

  if (ctx.data.dataError) return <p role="alert">Raid history could not be loaded: {ctx.data.dataError}. Reload to retry.</p>
  if (!ctx.data.raidPlanningLoaded) return <p role="status">Loading raid history...</p>
  if (loading && !reports.length && !errors.length) return <p role="status">Loading published raid snapshots...</p>

  return <div className="raid-history-audit">
    <div className="raid-history-actions"><button className="button button-secondary" type="button" onClick={refresh}>Refresh snapshots</button></div>
    {errors.length > 0 && <div className="raid-history-errors" role="alert">
      <strong>Some published raid history could not be loaded.</strong>
      <ul>{errors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul>
      <button className="button button-secondary" type="button" onClick={refresh}>Retry snapshot reads</button>
    </div>}
    {reports.length === 0 ? <div className="empty-state raid-history-empty">
      <strong>No published raid snapshots</strong>
      <p>{errors.length ? 'Resolve the read errors above and retry.' : 'Completed snapshots will appear here when available.'}</p>
    </div> : <div className="raid-history-browser">
      <section className="raid-history-reports" aria-label="Published raid reports">
        <h2>Raid groups</h2>
        <div className="raid-history-report-list">
          {reports.map((report) => <button
            className={report.id === selectedReport?.id ? 'raid-history-report selected' : 'raid-history-report'}
            key={report.id}
            type="button"
            aria-pressed={report.id === selectedReport?.id}
            onClick={() => setSelectedId(report.id)}
          >
            <strong>{report.label}</strong>
            <small>{report.raidName} · {report.characterIds.length} scheduled · {report.benchIds.length} benched</small>
          </button>)}
        </div>
      </section>
      {selectedReport && <section className="raid-history-report-detail" aria-label={`${selectedReport.label} snapshot`}>
        <div className="raid-history-detail-heading">
          <div>
            <h2>{selectedReport.label}</h2>
            <p>{selectedReport.raidName} · Scheduled {selectedReport.scheduledStartAt.toDate().toLocaleString()} · Captured {selectedReport.capturedAt.toDate().toLocaleString()}</p>
          </div>
          <span className="raid-history-read-only">Read only snapshot</span>
        </div>
        {rosterLoading && <p role="status">Loading captured roster...</p>}
        {rosterError && <p role="alert" className="raid-history-inline-error">{rosterError}</p>}
        {roster && <>
          <RosterTable report={selectedReport} roster={roster} />
          <button className="button button-secondary raid-history-responses-button" type="button" aria-expanded={showInvitations} onClick={toggleInvitations}>
            {showInvitations ? 'Invitation & sign-up responses' : 'Show invitation & sign-up responses'}
          </button>
          {showInvitations && <InvitationTable rows={currentInvitationState.rows} loading={currentInvitationState.loading} error={currentInvitationState.error} retry={() => fetchInvitations(selectedReport)} />}
        </>}
      </section>}
    </div>}
  </div>
}

function RosterTable({ report, roster }: { report: SnapshotReport; roster: SnapshotReportRoster }) {
  return <div className="table-scroll">
    <table className="data-table raid-history-table">
      <thead><tr><th>CHARACTER</th><th>CLASS</th><th>SPECIALIZATION</th><th>ROLE</th><th>PLACEMENT</th></tr></thead>
      <tbody>
        {roster.team.map((character) => <CharacterRow key={`${report.id}:${character.id}`} character={character} placement={report.teamName} />)}
        {roster.bench.map((character) => <CharacterRow key={`${report.id}:bench:${character.id}`} character={character} placement="Assigned bench" />)}
        {!roster.team.length && !roster.bench.length && <EmptyRow colSpan={5} title="No captured characters" detail="This published lineup contains no team or bench assignments." />}
      </tbody>
    </table>
  </div>
}

function CharacterRow({ character, placement }: { character: SnapshotReportRoster['team'][number]; placement: string }) {
  const className = character.className
  const fullName = [character.name, character.surname].filter(Boolean).join(' ') || 'Unknown character'
  return <tr className={`raid-history-character class-accent-row${className ? ` class-color-${classColorKey(className)}` : ''}`}>
    <td><strong>{fullName}</strong></td>
    <td>{className ?? 'Not recorded'}</td>
    <td>{character.specialization ?? 'Not recorded'}</td>
    <td>{character.role ?? 'Not recorded'}</td>
    <td>{placement}</td>
  </tr>
}

function InvitationTable({ rows, loading, error, retry }: { rows: SnapshotInvitationRow[] | null; loading: boolean; error: string; retry: () => void }) {
  if (loading) return <p role="status">Loading captured invitations and responses...</p>
  if (error) return <p role="alert" className="raid-history-inline-error">{error} <button type="button" className="button button-secondary" onClick={retry}>Retry</button></p>
  if (!rows) return null
  return <div className="table-scroll">
    <table className="data-table raid-history-table raid-history-response-table">
      <thead><tr><th>ACCOUNT DISPLAY NAME</th><th>INVITED CHARACTER</th><th>INVITATION</th><th>SIGN-UP CHARACTER</th><th>RESPONSE</th></tr></thead>
      <tbody>
        {rows.map(({ account, invitationCharacter, signupCharacter }) => <tr key={account.uid}>
          <td>{account.displayName ?? 'Not recorded'}</td>
          <td>{invitationCharacter ? [invitationCharacter.name, invitationCharacter.surname].filter(Boolean).join(' ') : '—'}</td>
          <td>{account.invited ? `Invited${account.invitationOrder === null ? '' : ` · #${account.invitationOrder + 1}`}` : 'Not invited'}</td>
          <td>{signupCharacter ? [signupCharacter.name, signupCharacter.surname].filter(Boolean).join(' ') : '—'}</td>
          <td>{account.signup ? `${account.signup.status}${account.signup.benchKind === 'self' ? ' · voluntary bench' : ''}` : 'No response'}</td>
        </tr>)}
        {!rows.length && <EmptyRow colSpan={5} title="No captured invitations or sign-ups" detail="No account response records were present in this snapshot." />}
      </tbody>
    </table>
  </div>
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied') {
    return 'You do not have permission to read this published raid history.'
  }
  return error instanceof Error ? error.message : fallback
}
