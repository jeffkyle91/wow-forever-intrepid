import { useId, useState } from 'react'
import type { CommentFeed } from '../../rosterComments'

export function RosterCommentCell({ feed, uid, audience, name }: { feed: CommentFeed; uid?: string; audience: string; name: string }) {
  const tooltipId = useId()
  const [position, setPosition] = useState({ left: 12, top: 12 })
  if (!uid) return <td className="roster-comment-cell"><span className="table-subtext">No linked account</span></td>
  if (feed.loading) return <td className="roster-comment-cell"><span role="status">Loading...</span></td>
  const comment = feed.records.find((record) => record.id === uid)
  return <td className="roster-comment-cell">
    {feed.error && <p role="alert">Could not load all comments: {feed.error}</p>}
    {comment ? <div className="roster-comment-details table-subtext" key={`${uid}-${comment.text}`}>
      <button type="button" className="roster-comment-trigger" popoverTarget={tooltipId}
        aria-label={`Read ${audience.toLowerCase()} comment for ${name}`}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setPosition({
            left: Math.max(12, Math.min(rect.left, window.innerWidth - 312)),
            top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 232)),
          })
        }}>
        <span className="roster-comment-preview">{comment.text.length > 70 ? `${comment.text.slice(0, 70)}...` : comment.text}</span>
        <span className="roster-comment-expand">Read comment</span>
      </button>
      <div id={tooltipId} popover="auto" className="roster-comment-tooltip" style={position} role="note" aria-label={`${audience} comment for ${name}`}>
        <strong>{audience} comment</strong>
        <p className="roster-comment-text">{comment.text}</p>
      </div>
    </div> : !feed.error && <span className="table-subtext">No comment</span>}
  </td>
}
