// The artwork of the zones: pictures a Guild Leader uploaded (Settings > Zone images) and which picture each zone uses (Settings > Zones). Nothing here names a zone, so
// a new raid needs a picture and a pick, not a release. The files are in Cloud Storage (storage.rules) and the list is one settings document, `settings/zoneArt`:
// `images` maps a picture's id to its name, size and where its files are, and `art` maps a zone's key (see zoneColors.ts) to a picture's id. The rules count the entries
// but cannot look at each one, so everything is read through readZoneArt, which keeps only what is well formed and points at this guild's own folder of this app's own
// bucket: a picture whose file paths or addresses are not exactly what the app writes for it is dropped (the app deletes files by these paths and puts the address in a
// style, so neither is taken on trust).
// Only imports zone keys, so Node runs the tests directly.
import { isZoneKey } from './zoneColors.ts'

export const ZONE_IMAGE_NAME_MAX = 60
/** The pictures a guild may keep (the rules bound the list at 200; the page stops a little short so a removal is never needed to make room). */
export const ZONE_IMAGE_LIMIT = 150
export const FULL_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const THUMB_IMAGE_MAX_BYTES = 300 * 1024
/** The biggest picture the guild keeps: a side of at most this many pixels and at most this many pixels in all (a browser decodes the whole picture to draw its banner). */
export const MAX_IMAGE_SIDE = 8192
export const MAX_IMAGE_PIXELS = 40_000_000
/** The thumbnail is this wide (its height follows), and is a JPEG. */
export const THUMB_WIDTH = 480

/** The types a picture may have and the extension its file gets (storage.rules accepts exactly these). */
export const IMAGE_EXTENSIONS: Readonly<Record<string, 'jpg' | 'png' | 'webp'>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export type ZoneImage = {
  id: string
  name: string
  /** 1 for the picture as first uploaded, one more for each time it is replaced; a file is never overwritten, so a new rev is a new file and a new address. */
  rev: number
  bytes: number
  width: number
  height: number
  /** The storage path of the picture as uploaded, and its address. */
  full: string
  fullUrl: string
  /** The storage path of the small copy, and its address. */
  thumb: string
  thumbUrl: string
}

export type ZoneArt = {
  /** Every well formed picture, by name. */
  images: ZoneImage[]
  /** The picture of each zone that has one, by the zone's key. Only a picture that exists and a zone key are kept. */
  art: Record<string, string>
}

export const EMPTY_ZONE_ART: ZoneArt = { images: [], art: {} }

/** Where this app's pictures are: the guild whose folder it is and the storage bucket (the app's own, see firebase.ts). */
export type ZoneArtSource = { guildId: string; bucket: string }

export const IMAGE_ID = /^[a-z0-9]{6,40}$/
export const isImageId = (value: unknown): value is string => typeof value === 'string' && IMAGE_ID.test(value)

// An address the browser can load from: Cloud Storage's own host, or the local emulator. Nothing that could break out of a url("...") in a style.
const SAFE_URL = /^(?:https:\/\/firebasestorage\.googleapis\.com|http:\/\/(?:127\.0\.0\.1|localhost):[0-9]{2,5})\/v0\/b\/[A-Za-z0-9._-]{1,100}\/o\/[A-Za-z0-9%._~-]{1,300}\?[A-Za-z0-9=&%._~-]{1,400}$/
export const isSafeImageUrl = (value: unknown): value is string => typeof value === 'string' && value.length <= 800 && SAFE_URL.test(value)

// Whether an address is the download address of this very file in this bucket: .../v0/b/<bucket>/o/<the path with its slashes written %2F>?<query>.
function isAddressOf(value: unknown, bucket: string, path: string): value is string {
  if (!isSafeImageUrl(value)) return false
  const [location] = value.split('?')
  return location.endsWith(`/v0/b/${bucket}/o/${encodeURIComponent(path)}`)
}

/** Where the picture and its small copy are in storage for a rev. */
export const fullPath = (guildId: string, id: string, rev: number, extension: string) => `guilds/${guildId}/zone-art/${id}/full-${rev}.${extension}`
export const thumbPath = (guildId: string, id: string, rev: number) => `guilds/${guildId}/zone-art/${id}/thumb-${rev}.jpg`

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= max ? value.trim() : null)
const wholeNumber = (value: unknown, min: number, max: number): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null)

// A picture as the settings keep it, or nothing when any part is wrong. The paths have to be this picture's own files at this rev in this guild's folder, and the
// addresses have to be the download addresses of those very files in this app's bucket.
function readImage(id: string, value: unknown, source: ZoneArtSource): ZoneImage | null {
  if (!isImageId(id) || typeof value !== 'object' || value === null) return null
  const entry = value as Record<string, unknown>
  const name = text(entry.name, ZONE_IMAGE_NAME_MAX)
  const rev = wholeNumber(entry.rev, 1, 1_000_000)
  const bytes = wholeNumber(entry.bytes, 1, FULL_IMAGE_MAX_BYTES)
  const width = wholeNumber(entry.width, 1, MAX_IMAGE_SIDE)
  const height = wholeNumber(entry.height, 1, MAX_IMAGE_SIDE)
  if (name === null || rev === null || bytes === null || width === null || height === null || width * height > MAX_IMAGE_PIXELS) return null
  if (typeof entry.full !== 'string' || typeof entry.thumb !== 'string') return null
  const folder = `guilds/${source.guildId}/zone-art/${id}/`
  if (!entry.full.startsWith(folder) || !new RegExp(`^full-${rev}\\.(?:jpg|png|webp)$`).test(entry.full.slice(folder.length))) return null
  if (entry.thumb !== `${folder}thumb-${rev}.jpg`) return null
  if (!isAddressOf(entry.fullUrl, source.bucket, entry.full) || !isAddressOf(entry.thumbUrl, source.bucket, entry.thumb)) return null
  return { id, name, rev, bytes, width, height, full: entry.full, fullUrl: entry.fullUrl, thumb: entry.thumb, thumbUrl: entry.thumbUrl }
}

/** The artwork as the settings document `settings/zoneArt` holds it (`images` and `art` as read from Firestore, anything may be in them). */
export function readZoneArt(images: unknown, art: unknown, source: ZoneArtSource): ZoneArt {
  const list: ZoneImage[] = []
  if (typeof images === 'object' && images !== null && !Array.isArray(images)) {
    for (const [id, value] of Object.entries(images)) {
      const image = readImage(id, value, source)
      if (image) list.push(image)
    }
  }
  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
  const known = new Set(list.map((image) => image.id))
  const picks: Record<string, string> = {}
  if (typeof art === 'object' && art !== null && !Array.isArray(art)) {
    for (const [zone, id] of Object.entries(art)) if (isZoneKey(zone) && isImageId(id) && known.has(id)) picks[zone] = id
  }
  return { images: list, art: picks }
}

/** The picture a zone uses, if it has one. */
export function imageOfZone(zoneArt: ZoneArt, zoneKey: number | string): ZoneImage | undefined {
  const id = zoneArt.art[String(zoneKey)]
  return id === undefined ? undefined : zoneArt.images.find((image) => image.id === id)
}

/** The keys of the zones that use a picture. */
export const zonesUsing = (zoneArt: ZoneArt, imageId: string): string[] => Object.entries(zoneArt.art).filter(([, id]) => id === imageId).map(([zone]) => zone)

/**
 * A name for a picture from the name of its file: "Onyxia's_Lair_loading_screen.jpg" becomes "Onyxia's Lair". The extension, a trailing "loading screen" and the
 * underscores used as spaces go (a dash stays: Azjol-Nerub has one); what is left is cut to the longest name allowed. A file with nothing usable in its name is called "Picture".
 */
export function imageNameFromFile(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,5}$/, '')
  const spaced = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[\s-]*loading[\s-]*screen$/i, '').trim()
  const cut = spaced.slice(0, ZONE_IMAGE_NAME_MAX).trim()
  return cut || 'Picture'
}

// A name made loose enough to match a zone with its picture: no case, no apostrophes or other marks, and without "the" and "old" ("Scarlet Monastery" and
// "Scarlet Monastery old" are the same place; the old loading screen is named that way on the wiki the pictures come from).
const looseName = (name: string) => name.toLowerCase().replace(/['\u2019]/g, '').replace(/\b(?:the|old)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The pictures to give the zones that have none: a zone is matched with the picture whose name is the same (loosely, see looseName) when exactly one picture has it.
 * A zone that has a picture is left alone, and so is one whose name two pictures share.
 */
export function matchImagesToZones(zones: ReadonlyArray<{ key: string; name: string }>, zoneArt: ZoneArt): Record<string, string> {
  const byName = new Map<string, string[]>()
  for (const image of zoneArt.images) { const key = looseName(image.name); if (key) byName.set(key, [...(byName.get(key) ?? []), image.id]) }
  const picks: Record<string, string> = {}
  for (const zone of zones) {
    if (!isZoneKey(zone.key) || zoneArt.art[zone.key] !== undefined) continue
    const found = byName.get(looseName(zone.name))
    if (found?.length === 1) picks[zone.key] = found[0]
  }
  return picks
}

/** Whether a name is allowed for a picture (as the settings keep it). */
export const isImageName = (value: string): boolean => text(value, ZONE_IMAGE_NAME_MAX) !== null

/** A new picture id: 20 lowercase letters and digits from the random bytes given (the browser's by default). */
export function newImageId(randomBytes: (count: number) => ArrayLike<number> = (count) => crypto.getRandomValues(new Uint8Array(count))): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(randomBytes(20), (byte) => alphabet[byte % alphabet.length]).join('')
}
