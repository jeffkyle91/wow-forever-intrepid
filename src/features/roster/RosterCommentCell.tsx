import { HelpPopover } from '../../shared/ui/HelpPopover'
import type { CommentFeed } from '../../rosterComments'

export function RosterCommentCell({ feed, uid, audience, name }: { feed: CommentFeed; uid?: string; audience: string; name: string }) {
  if (!uid) return <td className="roster-comment-cell"><span className="table-subtext">No linked account</span></td>
  if (feed.loading) return <td className="roster-comment-cell"><span role="status">Loading...</span></td>
  const comment = feed.records.find((record) => record.id === uid)
  return <td className="roster-comment-cell">
    {feed.error && <p role="alert">Could not load all comments: {feed.error}</p>}
    {comment ? <div className="roster-comment-details table-subtext" key={`${uid}-${comment.text}`}>
      <HelpPopover triggerClassName="roster-comment-trigger" label={`Read ${audience.toLowerCase()} comment for ${name}`} trigger={<>
        <span className="roster-comment-preview">{comment.text.length > 70 ? `${comment.text.slice(0, 70)}...` : comment.text}</span>
        <span className="roster-comment-expand">Read comment</span>
      </>}>
        <strong>{audience} comment</strong>
        <p className="roster-comment-text">{comment.text}</p>
      </HelpPopover>
    </div> : !feed.error && <span className="table-subtext">No comment</span>}
  </td>
}
