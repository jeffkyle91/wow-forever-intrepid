import type { CSSProperties } from 'react'
import type { RaidZoneRecord } from '../../guildApi'
import type { ZoneArt } from '../game/zoneArt'
import { raidZoneColor, raidZoneImage } from './raidZoneArt'
import './RaidBanner.css'

type ZoneLook = { zoneArt: ZoneArt; zoneColors: Readonly<Record<string, unknown>> }
type ZoneOf = Pick<RaidZoneRecord, 'id'>

// A picture that fails to load is hidden, which leaves the zone's color tint under it.
const hideBrokenPicture = (event: { currentTarget: HTMLImageElement }) => { event.currentTarget.hidden = true }
const tint = (zone: ZoneOf, zoneColors: ZoneLook['zoneColors']) => ({ '--zone-color': raidZoneColor(zone.id, zoneColors) }) as CSSProperties

/**
 * The pictures of a scheduled raid's zones side by side, in the order the raid lists them, each one fading semitransparently into the next. A zone with no picture is a
 * tint of its color. Decorative (the zone names are text beside it) and filling its parent, which sets the height, so nothing moves while pictures load. The small copy of
 * each picture is used and loaded lazily: a list of raids is long, and a closed one shows no banner at all.
 */
export function RaidBanner({ zones, zoneArt, zoneColors }: { zones: readonly ZoneOf[] } & ZoneLook) {
  const slices = zones.length ? zones : [{ id: '' }]
  return <div className="raid-banner" aria-hidden="true" style={{ '--raid-banner-slices': slices.length } as CSSProperties}>
    {slices.map((zone, index) => {
      const image = raidZoneImage(zoneArt, zone.id)
      return <span className="raid-banner-slice" key={`${index}:${zone.id}`} style={tint(zone, zoneColors)}>
        {image && <img src={image.thumbUrl} alt="" loading="lazy" decoding="async" onError={hideBrokenPicture} />}
      </span>
    })}
  </div>
}

/** One zone's picture, or its color, as a small swatch (the zone picker of Add Raid and Edit Raid). */
export function RaidZoneSwatch({ zone, zoneArt, zoneColors }: { zone: ZoneOf } & ZoneLook) {
  const image = raidZoneImage(zoneArt, zone.id)
  return <span className="raid-zone-swatch" aria-hidden="true" style={tint(zone, zoneColors)}>
    {image && <img src={image.thumbUrl} alt="" loading="lazy" decoding="async" onError={hideBrokenPicture} />}
  </span>
}
