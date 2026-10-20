import { useState } from 'react'
import { HelpPopover } from '../../shared/ui/HelpPopover'
import type { RaidGroup, StandingTeam } from '../../guildApi'
import type { RaidView, TeamOption } from '../../shared/game/teams'
import { calculateCoverage, summaryText } from './calculateCoverage'
import { coverageEffects } from './coverageData'
import { displayHint, displayLabel, encounterEffects, estimateExplanation, isEstimatedResult, standardEffects, statusGlyphs } from './coverageDisplay'
import { assignedMembers, coverageTargets } from './teamSelection'
import type { CoverageMember, CoverageStatus, EffectKind, ProviderMatch, RequirementResult } from './types'
import './RaidCoveragePanel.css'

const statusOrder: CoverageStatus[] = ['missing', 'contested', 'indeterminate', 'potential', 'available', 'party-unknown', 'unverified']

const kindLabels: Record<EffectKind, string> = {
  'raid-buff': 'Raid-wide buff',
  'party-buff': 'Party-wide buff',
  'targeted-buff': 'Targeted buff',
  debuff: 'Enemy debuff',
}

function providerText(match: ProviderMatch) {
  const basis = match.confirmed ? '' : match.estimable ? 'provisional' : 'unverified, not counted'
  const assumed = match.eligibility === 'assumed' ? `assumed from specialization, ${match.talent ?? 'talent'} not tracked` : ''
  const detail = [match.specialization || match.className, assumed || (match.talent ? `needs ${match.talent}` : match.eligibility === 'possible' ? 'specialization not confirmed' : ''), basis].filter(Boolean).join(', ')
  return `${match.playerName} (${detail})`
}

function RequirementRow({ requirement }: { requirement: RequirementResult }) {
  const { kind, matches, estimate } = requirement
  const players = new Set(matches.map((match) => match.playerId)).size
  const label = kind === 'targeted-buff' ? `Eligible providers (${players}); recipients unknown` : kind === 'party-buff' ? `Candidate providers (${players}); party membership unknown` : `Providers (${players})`
  const estimated = isEstimatedResult(requirement.basis, estimate.status)
  const explanation = estimateExplanation(requirement)
  return <li className="cov-row">
    <div className="cov-row-head">
      <strong>{requirement.name}</strong>
      <HelpPopover label={`${requirement.name}: ${displayLabel(estimate.status, estimated)}`} triggerClassName={`cov-status cov-status-${estimate.status}${estimated ? ' cov-status-est' : ''}`} trigger={<><span aria-hidden="true">{statusGlyphs[estimate.status]} </span>{displayLabel(estimate.status, estimated)}</>}>
        <p>{displayHint(estimate.status, estimated)}</p>
      </HelpPopover>
    </div>
    <p className="cov-scope">{[...new Set(requirement.effects.map((effect) => kindLabels[effect.kind]))].join(' / ')}{estimate.required > 1 ? `, needs ${estimate.required} different players (${estimate.availableCount} counting guaranteed or specialization-assumed providers, ${estimate.potentialCount} including possible talents)` : ''}</p>
    {requirement.basis !== 'verified' && <p className="cov-note">{requirement.basis === 'estimated' ? 'Estimate from provisional data; not verified in game. Unverified effects are not counted.' : 'No effect here has supported data, so no coverage is estimated.'}</p>}
    {explanation && <p className="cov-conflict">{explanation}</p>}
    {matches.length > 0 && <p className="cov-providers">{label}: {matches.map(providerText).join(', ')}</p>}
    <ul className="cov-facts">{requirement.effects.map((effect) => <li key={effect.id}>
      <span>{requirement.effects.length > 1 ? `${effect.name}: ` : ''}{effect.category ? `${effect.category}; ` : ''}confidence {effect.confidence}, scope {effect.scopeStatus}{effect.verifiedOn ? `, checked ${effect.verifiedOn}` : ''}. {effect.sources.join('; ')}</span>
      {effect.notes && <span> {effect.notes}</span>}
    </li>)}</ul>
  </li>
}

export function RaidCoveragePanel({ view, teams, groupNames, players, assignments }: {
  view: RaidView
  teams: TeamOption[]
  groupNames: Record<RaidGroup, string>
  players: CoverageMember[]
  assignments: Record<string, StandingTeam>
}) {
  const [selected, setSelected] = useState('')
  const targets = coverageTargets(view, teams, groupNames)
  const target = targets.find((entry) => entry.key === selected) ?? targets[0]
  const members = assignedMembers(target.parts, players, assignments)
  const report = calculateCoverage(standardEffects(coverageEffects), members)
  const hidden = encounterEffects(coverageEffects).length

  return <details className="cov-panel">
    <summary className="cov-summary">
      <span className="cov-title">Buff and debuff coverage</span>
      <span className="cov-counts">{summaryText(report)}</span>
    </summary>
    <div className="cov-body">
      <div className="cov-controls">
        <label>Team <select value={target.key} onChange={(event) => setSelected(event.target.value)}>{targets.map((entry) => <option key={entry.key} value={entry.key}>{entry.name}</option>)}</select></label>
        <span>{report.memberCount} assigned {report.memberCount === 1 ? 'player' : 'players'}</span>
      </div>
      <p className="cov-note">Read-only. Based only on players assigned to this team, not on raid sign-ups. Talents and party groups are not tracked, so talent effects show as Potential unless the catalog explicitly assumes them for a specialization (shown as Estimated, never verified), and party buffs as Party Unknown. "Estimated" results rest on provisional Wowhead Forever data that has not been verified in game.</p>
      {hidden > 0 && <p className="cov-note">{hidden} encounter-specific effects (resistance auras, totems and protection buffs) are researched but not part of the standard checklist.</p>}
      {report.catalogErrors.length > 0
        ? <div className="cov-error" role="alert">
          <p><strong>Coverage catalog error.</strong> The catalog is invalid, so no coverage is shown. This is a data-file mistake, not a calculation limit. Fix coverageData.ts:</p>
          <ul>{report.catalogErrors.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </div>
        : report.requirements.length === 0
        ? <p className="cov-empty">No coverage data yet. Game facts are waiting on a verified source; see src/shared/raid-coverage/README.md.</p>
        : statusOrder.flatMap((status) => [false, true].map((estimated) => {
          const rows = report.requirements.filter((requirement) => requirement.estimate.status === status && isEstimatedResult(requirement.basis, status) === estimated)
          if (!rows.length) return null
          return <section className="cov-group" key={`${status}-${estimated}`}>
            <h4>{displayLabel(status, estimated)} ({rows.length})</h4>
            <p className="cov-note">{displayHint(status, estimated)}</p>
            <ul className="cov-list">{rows.map((requirement) => <RequirementRow key={requirement.key} requirement={requirement} />)}</ul>
          </section>
        }))}
    </div>
  </details>
}
