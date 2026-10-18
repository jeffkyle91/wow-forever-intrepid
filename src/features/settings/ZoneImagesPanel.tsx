import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ImagePlus, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { addZoneImage, removeZoneImage, renameZoneImage, replaceZoneImage } from '../../guildApi'
import { ZONE_IMAGE_LIMIT, ZONE_IMAGE_NAME_MAX, imageNameFromFile, isImageName, zonesUsing, type ZoneImage } from '../../shared/game/zoneArt'
import type { TabContext } from '../../shared/tabs/types'
import { prepareImage } from './zoneImageFile'
import './ZoneImages.css'

// The library of zone pictures (Guild Leaders): add pictures (several at once; each is named from its file, and a picture whose name is in the library already is skipped, so
// choosing the same folder twice adds nothing), rename, replace the file of one, remove one. Which picture a zone uses is chosen on the Zones page above. Replacing keeps the
// name and every zone that uses the picture; removing takes the picture away from those zones. The pictures are files in Cloud Storage and the list is one settings document
// (shared/game/zoneArt.ts); a picture is fetched by a browser once, when something shows it.
const accept = 'image/jpeg,image/png,image/webp'
const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()
const SEARCH_FROM = 8
const kilobytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export function ZoneImagesPanel({ ctx }: { ctx: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = ctx.feedback
  const images = ctx.data.zoneArt.images
  const who = { uid: ctx.identity.uid }
  const [progress, setProgress] = useState('')
  const [query, setQuery] = useState('')
  // What happened is said here, beside the controls, and not only in the notice at the foot of the page (below up to 150 cards).
  const [outcome, setOutcome] = useState<{ error: boolean; text: string } | null>(null)
  const zoneNames = useMemo(() => new Map(ctx.data.zoneList.map((zone) => [zone.key, zone.name])), [ctx.data.zoneList])
  const searching = images.length > SEARCH_FROM && query.trim() !== '' // a search typed before pictures were removed no longer hides the rest once the box is gone
  const shown = searching ? images.filter((image) => nameKey(image.name).includes(nameKey(query))) : images
  const usedBy = (image: ZoneImage) => zonesUsing(ctx.data.zoneArt, image.id).map((key) => zoneNames.get(key)).filter((name): name is string => name !== undefined).sort((a, b) => a.localeCompare(b))

  async function run(change: () => Promise<string>, failed: string) {
    setBusy(true)
    setOutcome(null)
    try {
      const done = await change()
      setMutationError('')
      setNotice('')
      setOutcome({ error: false, text: done })
    } catch (error) {
      setNotice('')
      setMutationError('')
      setOutcome({ error: true, text: error instanceof Error ? error.message : failed })
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = '' // so choosing the same files again fires another change
    if (!files.length) return
    await run(async () => {
      const known = new Set(images.map((image) => nameKey(image.name)))
      let added = 0
      const skipped: string[] = []
      const failures: string[] = []
      for (const [index, file] of files.entries()) {
        const name = imageNameFromFile(file.name)
        if (known.has(nameKey(name))) { skipped.push(name); continue }
        if (images.length + added >= ZONE_IMAGE_LIMIT) { failures.push(`${file.name}: the library is full (${ZONE_IMAGE_LIMIT} pictures)`); continue }
        setProgress(`Uploading ${index + 1} of ${files.length}: ${name}`)
        try {
          await addZoneImage(name, await prepareImage(file), who)
          known.add(nameKey(name))
          added += 1
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `${file.name} could not be added.`)
        }
      }
      if (failures.length && !added) throw new Error(failures.slice(0, 3).join(' ') + (failures.length > 3 ? ` (and ${failures.length - 3} more)` : ''))
      const parts = [`${added} ${added === 1 ? 'picture' : 'pictures'} added.`]
      if (skipped.length) parts.push(`${skipped.length} skipped, already in the library.`)
      if (failures.length) parts.push(`${failures.length} could not be added: ${failures.slice(0, 2).join(' ')}${failures.length > 2 ? ' ...' : ''}`)
      return parts.join(' ')
    }, 'Could not add the pictures.')
  }

  return <section className="settings-section zone-images-panel">
    <header>
      <h3>Zone images</h3>
      <p>Pictures for the zones, such as loading screens. Add as many as you like now, so they are ready when a zone arrives, then pick one for a zone on the Zones page above. A zone&apos;s picture shows faintly behind it in Priorities and Browse drops. JPEG, PNG or WebP, up to 5 MB each.</p>
    </header>
    <div className="zone-images-actions">
      <label className={busy ? 'button button-primary zone-images-pick is-disabled' : 'button button-primary zone-images-pick'}>
        <ImagePlus size={14} /> Add pictures
        <input type="file" accept={accept} multiple disabled={busy} onChange={(event) => void addFiles(event)} />
      </label>
      {images.length > SEARCH_FROM && <input className="zone-images-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pictures" aria-label="Search pictures" />}
      <small>{images.length} {images.length === 1 ? 'picture' : 'pictures'} (up to {ZONE_IMAGE_LIMIT})</small>
    </div>
    {progress && <p className="zone-images-progress" role="status">{progress}</p>}
    {outcome && <p className={outcome.error ? 'zone-images-outcome is-error' : 'zone-images-outcome'} role={outcome.error ? 'alert' : 'status'}>{outcome.text}</p>}
    {images.length === 0 && !progress && <p className="zones-empty">No pictures yet. Use Add pictures and choose the files (you can choose many at once).</p>}
    {shown.length === 0 && images.length > 0 && searching && <p className="zones-empty">No picture is called &ldquo;{query.trim()}&rdquo;.</p>}
    <ul className="zone-images-grid">
      {shown.map((image) => <ImageCard key={`${image.id}|${image.rev}|${image.name}`} image={image} usedBy={usedBy(image)} others={images.filter((other) => other.id !== image.id).map((other) => other.name)} busy={busy} run={run} who={who} />)}
    </ul>
  </section>
}

type Run = (change: () => Promise<string>, failed: string) => Promise<void>

function ImageCard({ image, usedBy, others, busy, run, who }: { image: ZoneImage; usedBy: string[]; others: string[]; busy: boolean; run: Run; who: { uid: string } }) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(image.name)
  const [confirming, setConfirming] = useState(false)
  const replaceInput = useRef<HTMLInputElement>(null)
  const taken = others.some((other) => nameKey(other) === nameKey(name))
  const nameOk = isImageName(name) && name.trim() !== image.name && !taken

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!nameOk) return
    void run(async () => { await renameZoneImage(image, name, who); setRenaming(false); return `The picture is now called ${name.trim()}.` }, 'Could not rename the picture.')
  }
  function replace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void run(async () => { await replaceZoneImage(image, await prepareImage(file), who); return `${image.name} has a new picture.${usedBy.length ? ' Every zone that uses it shows the new one.' : ''}` }, 'Could not replace the picture.')
  }
  function remove() {
    void run(async () => { await removeZoneImage(image, who); return usedBy.length ? `${image.name} was removed. ${usedBy.join(', ')} no longer ${usedBy.length === 1 ? 'has' : 'have'} artwork.` : `${image.name} was removed.` }, 'Could not remove the picture.')
  }

  return <li className="zone-image-card">
    <img src={image.thumbUrl} alt="" width={240} height={180} loading="lazy" decoding="async" />
    <div className="zone-image-body">
      {renaming
        ? <form className="zone-image-rename" onSubmit={rename}>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={ZONE_IMAGE_NAME_MAX} aria-label={`New name for ${image.name}`} disabled={busy} autoFocus />
          <button className="button button-primary" disabled={busy || !nameOk}>Save</button>
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setRenaming(false); setName(image.name) }}>Cancel</button>
          {taken && <small className="zones-note" role="status">Another picture is called that.</small>}
        </form>
        : <strong className="zone-image-name" title={image.name}>{image.name}</strong>}
      <small>{image.width} &times; {image.height} &middot; {kilobytes(image.bytes)}</small>
      <small className="zone-image-use">{usedBy.length ? `Used by ${usedBy.join(', ')}` : 'Not used by a zone yet'}</small>
      {confirming
        ? <div className="zone-image-confirm" role="group" aria-label={`Remove ${image.name}`}>
          <span>{usedBy.length ? `Remove it? ${usedBy.join(', ')} will have no artwork.` : 'Remove it?'}</span>
          <button type="button" className="button button-secondary" disabled={busy} onClick={remove}><Trash2 size={13} /> Remove</button>
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep</button>
        </div>
        : renaming ? null : <div className="zone-image-buttons">
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setName(image.name); setRenaming(true) }} aria-label={`Rename ${image.name}`}><Pencil size={13} /> Rename</button>
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => replaceInput.current?.click()} aria-label={`Replace the picture of ${image.name}`}><RefreshCw size={13} /> Replace</button>
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => setConfirming(true)} aria-label={`Remove ${image.name}`}><Trash2 size={13} /> Remove</button>
          <input ref={replaceInput} type="file" accept={accept} hidden onChange={replace} />
        </div>}
    </div>
  </li>
}
