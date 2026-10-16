import { useEffect, useState } from 'react'
import { signupLabels, subscribeRaidSignups, type RaidSignup } from '../../raidSignups'
import { RaidSignupModal } from '../../shared/raids/RaidSignupModal'
import type { TabContext } from '../../shared/tabs/types'

export function RaidSignupButton({ raidId, unavailable, ctx }: { raidId: string; unavailable: boolean; ctx: TabContext }) {
  const [signups, setSignups] = useState<RaidSignup[] | null>(null)
  const [readError, setReadError] = useState('')
  useEffect(() => subscribeRaidSignups(raidId, (records) => { setSignups(records); setReadError('') }, (error) => {
    setSignups(null)
    setReadError(`Could not load your raid response: ${error.message}`)
  }), [raidId])
  const mine = signups?.find((signup) => signup.id === ctx.identity.uid)
  const status = unavailable ? 'absent' : mine?.status
  const response = status === 'accept' ? 'Accepted' : status ? signupLabels[status] : ''

  return <>
    <button type="button" className="button button-secondary dash-raid-signup raid-response-button raid-response-summary"
      data-response={readError ? undefined : status}
      onClick={() => ctx.openModal(({ close, live }) => <RaidSignupModal raidId={raidId} close={close} live={live} />)}>
      {readError ? 'View sign-up details' : response ? <><span>{response}</span><span className="dash-raid-signup-hint">Click to change or view details</span></> : signups === null ? 'Loading response…' : 'Sign-up / roster'}
    </button>
    {readError && <span className="dash-raid-error" role="alert">{readError}</span>}
  </>
}
