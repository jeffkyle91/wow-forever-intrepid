import type { RaidSize, RaidZoneRecord } from '../../guildApi'
import type { ZoneArt } from '../../shared/game/zoneArt'
import { RaidBanner, RaidZoneSwatch } from '../../shared/raids/RaidBanner'

const sizes: RaidSize[] = [10, 20, 40]

// `savedZones` are the zones a raid already has: one the picker no longer offers has no checkbox but is still part of the raid, so the preview shows it as the save keeps it.
export function RaidZonePicker({ zones, selectedIds, onChange, zoneArt, zoneColors, savedZones }: {
  zones: RaidZoneRecord[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  zoneArt: ZoneArt
  zoneColors: Readonly<Record<string, unknown>>
  savedZones?: readonly RaidZoneRecord[]
}) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id])
  }

  if (!zones.length) return <p className="raid-modal-note">No raid zones are configured. A Guild Leader can add zones and player sizes in Settings.</p>

  const preview = selectedIds.map((id) => zones.find((zone) => zone.id === id) ?? savedZones?.find((zone) => zone.id === id)).filter((zone) => zone !== undefined)
  return <fieldset className="raid-zone-picker">
    <legend>Zones included</legend>
    {sizes.map((size) => {
      const options = zones.filter((zone) => zone.size === size)
      if (!options.length) return null
      return <div className="raid-zone-picker-group" key={size}>
        <strong>{size}-player</strong>
        {options.map((zone) => <label key={zone.id}><input type="checkbox" checked={selectedIds.includes(zone.id)} onChange={() => toggle(zone.id)} /><RaidZoneSwatch zone={zone} zoneArt={zoneArt} zoneColors={zoneColors} />{zone.name}</label>)}
      </div>
    })}
    {preview.length > 0 && <div className="raid-zone-preview-field">
      <span>Raid banner</span>
      <div className="raid-zone-preview"><RaidBanner zones={preview} zoneArt={zoneArt} zoneColors={zoneColors} /></div>
    </div>}
  </fieldset>
}
