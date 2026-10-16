import type { RaidSize, RaidZoneRecord } from '../../guildApi'

const sizes: RaidSize[] = [10, 20, 40]

export function RaidZonePicker({ zones, selectedIds, onChange }: { zones: RaidZoneRecord[]; selectedIds: string[]; onChange: (ids: string[]) => void }) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id])
  }

  if (!zones.length) return <p className="raid-modal-note">No raid zones are configured. A Guild Leader can add zones and player sizes in Settings.</p>

  return <fieldset className="raid-zone-picker">
    <legend>Zones included</legend>
    {sizes.map((size) => {
      const options = zones.filter((zone) => zone.size === size)
      if (!options.length) return null
      return <div className="raid-zone-picker-group" key={size}>
        <strong>{size}-player</strong>
        {options.map((zone) => <label key={zone.id}><input type="checkbox" checked={selectedIds.includes(zone.id)} onChange={() => toggle(zone.id)} />{zone.name}</label>)}
      </div>
    })}
  </fieldset>
}
