import { useState } from 'react'
import { HelpPopover } from '../../shared/ui/HelpPopover'
import type { RaidGroup, StandingTeam } from '../../guildApi'
import type { RaidView, TeamOption } from '../../shared/game/teams'
import { calculateCoverage, summaryText } from './calculateCoverage'
import { coverageEffects } from './coverageData'
import { displayHint, displayLabel, encounterEffects, planningExplanation, standardEffects, statusGlyphs } from './coverageDisplay'
import { assignedMembers, coverageTargets } from './teamSelection'
import { providerRulesOf } from './coverageTooltip'
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
  const assumed = match.eligibility === 'assumed' ? `assumed from specialization, ${match.talent ?? 'talent'} not tracked` : ''
  const detail = [match.specialization || match.className, assumed || (match.talent ? `needs ${match.talent}` : match.eligibility === 'possible' ? 'specialization not confirmed' : '')].filter(Boolean).join(', ')
  return `${match.playerName} (${detail})`
}

function RequirementRow({ requirement }: { requirement: RequirementResult }) {
  const { kind, matches, planning } = requirement
  const players = new Set(matches.map((match) => match.playerId)).size
  const label = kind === 'targeted-buff' ? `Eligible providers (${players}); recipients unknown` : kind === 'party-buff' ? `Candidate providers (${players}); party membership unknown` : `Providers (${players})`
  const explanation = planningExplanation(requirement)
  return <li className="cov-row">
    <div className="cov-row-head">
      <strong>{requirement.name}</strong>
      <HelpPopover label={`${requirement.name}: ${displayLabel(planning.status)}`} triggerClassName={`cov-status cov-status-${planning.status}`} trigger={<><span aria-hidden="true">{statusGlyphs[planning.status]} </span>{displayLabel(planning.status)}</>}>
        <p>{displayHint(planning.status)}</p>
      </HelpPopover>
    </div>
    <p className="cov-scope">{[...new Set(requirement.effects.map((effect) => kindLabels[effect.kind]))].join(' / ')}{planning.required > 1 ? `, needs ${planning.required} different players (${planning.availableCount} counting guaranteed or specialization-assumed providers, ${planning.potentialCount} including possible talents)` : ''}</p>
    {explanation && <p className="cov-conflict">{explanation}</p>}
    {matches.length > 0 && <p className="cov-providers">{label}: {matches.map(providerText).join(', ')}</p>}
    <ul className="cov-facts">{requirement.effects.map((effect) => <li key={effect.id}>
      <span>{requirement.effects.length > 1 ? `${effect.name}: ` : ''}{effect.category ? `${effect.category}; ` : ''}Eligible providers: {providerRulesOf([effect]).join('; ')}.</span>
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
      <p className="cov-note">Based on players assigned to this team, not raid sign-ups. Available means an eligible provider is assigned, not that the spell is active or every player receives it. Talents are not tracked: talent effects show Potential unless the catalog assumes them for the assigned specialization. Party groups are not tracked, so party-only effects show Party Unknown. Separate requirements do not imply that all effects can be maintained simultaneously.</p>
      {hidden > 0 && <p className="cov-note">{hidden} encounter-specific effects (resistance auras, totems and protection buffs) are not part of the standard checklist.</p>}
      {report.catalogErrors.length > 0
        ? <div className="cov-error" role="alert">
          <p><strong>Coverage catalog error.</strong> The catalog is invalid, so no coverage is shown. This is a data-file mistake, not a calculation limit. Fix coverageData.ts:</p>
          <ul>{report.catalogErrors.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </div>
        : report.requirements.length === 0
        ? <p className="cov-empty">No coverage data yet.</p>
        : statusOrder.map((status) => {
          const rows = report.requirements.filter((requirement) => requirement.planning.status === status)
          if (!rows.length) return null
          return <section className="cov-group" key={status}>
            <h4>{displayLabel(status)} ({rows.length})</h4>
            <ul className="cov-list">{rows.map((requirement) => <RequirementRow key={requirement.key} requirement={requirement} />)}</ul>
          </section>
        })}
    </div>
  </details>
}
