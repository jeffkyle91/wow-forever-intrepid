import { Check, CircleHelp, Clock, Hourglass, Armchair, X } from 'lucide-react'
import type { PlayerRecord } from '../../guildApi'
import type { RaidSignup } from '../../raidSignups'
import { scheduledResponseCounts, type RaidInvitation } from './planning'
import './ScheduledResponseSummary.css'

const statuses = [
  { key: 'accept', label: 'Accepted', Icon: Check },
  { key: 'tentative', label: 'Tentative', Icon: CircleHelp },
  { key: 'absent', label: 'Absent', Icon: X },
  { key: 'late', label: 'Late', Icon: Clock },
  { key: 'bench', label: 'Bench (voluntary)', Icon: Armchair },
  { key: 'unanswered', label: 'Not Responded', Icon: Hourglass },
] as const

export function ScheduledResponseSummary({ characterIds, invitations, characters, responses }: {
  characterIds: string[]
  invitations: RaidInvitation[]
  characters: PlayerRecord[]
  responses: RaidSignup[]
}) {
  const counts = scheduledResponseCounts(characterIds, invitations, characters, responses)
  const shown = statuses.filter(({ key }) => (key !== 'late' && key !== 'bench') || counts[key] > 0)
  return <div className="scheduled-response-summary" role="group" aria-label="Team responses">
    {shown.map(({ key, label, Icon }) => <span key={key} className={`scheduled-response-count response-${key}`} title={`${label}: ${counts[key]}`} aria-label={`${label}: ${counts[key]}`}>
      <Icon size={12} aria-hidden="true" /><strong>{counts[key]}</strong>
    </span>)}
  </div>
}
