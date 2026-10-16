import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { COMMENT_MAX_LENGTH, deleteMyComment, saveMyComment, subscribeMyComment, type CommentKind } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'

const KINDS: { kind: CommentKind; label: string; hint: string }[] = [
  { kind: 'public', label: 'Public', hint: 'Every guild member can read this.' },
  { kind: 'leadership', label: 'Leadership', hint: 'Only Guild Leaders, Raid Leaders and you can read this.' },
]

export function CommentsPanel({ ctx }: { ctx: TabContext }) {
  const [kind, setKind] = useState<CommentKind>('public')
  return <>
    <div className="dash-segment" role="tablist" aria-label="Comment audience">
      {KINDS.map((option) => <button key={option.kind} role="tab" aria-selected={kind === option.kind} className={kind === option.kind ? 'active' : ''} onClick={() => setKind(option.kind)}>{option.label}</button>)}
    </div>
    <CommentEditor key={kind} kind={kind} hint={KINDS.find((option) => option.kind === kind)!.hint} ctx={ctx} />
  </>
}

function CommentEditor({ kind, hint, ctx }: { kind: CommentKind; hint: string; ctx: TabContext }) {
  const { uid, displayName } = ctx.identity
  const { busy, setBusy, setMutationError, setNotice } = ctx.feedback
  const [saved, setSaved] = useState<string | null | undefined>(undefined)
  // null until the member types, so the box follows the stored comment until then.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? saved ?? ''

  useEffect(() => {
    if (!uid) return undefined
    return subscribeMyComment(kind, uid, setSaved, (error) => setMutationError(error.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setMutationError comes from a ctx rebuilt on every render
  }, [kind, uid])

  async function run(action: () => Promise<void>, done: string, failed: string) {
    setBusy(true)
    try {
      await action()
      setMutationError('')
      setNotice(done)
      setDraft(null)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : failed)
    } finally {
      setBusy(false)
    }
  }

  const trimmed = text.trim()
  const unchanged = trimmed === (saved ?? '')

  return <div className="dash-comment">
    <p className="dash-note">{hint}</p>
    <textarea value={text} maxLength={COMMENT_MAX_LENGTH} rows={3} placeholder={saved === undefined ? 'Loading…' : 'Add a comment'} disabled={saved === undefined} onChange={(event) => setDraft(event.target.value)} />
    <div className="dash-comment-actions">
      <small>{text.length}/{COMMENT_MAX_LENGTH}</small>
      {saved && <button className="button button-secondary" disabled={busy} onClick={() => run(() => deleteMyComment(kind, uid), 'Comment removed.', 'Could not remove comment.')}><Trash2 size={14} /> Remove</button>}
      <button className="button button-primary" disabled={busy || !trimmed || unchanged} onClick={() => run(() => saveMyComment(kind, uid, displayName, trimmed), 'Comment saved.', 'Could not save comment.')}>Save</button>
    </div>
  </div>
}
