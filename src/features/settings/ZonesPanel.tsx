import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { clearZoneColors, deleteRaidZone, saveRaidZone, saveZoneColor, saveZoneColors, writeLootTables, type RaidSize } from '../../guildApi'
import { addZone, editZone, hasText, type LootTableDoc, type ZoneKind } from '../../shared/game/guildTables'
import { currentPhaseNo } from '../../shared/game/phases'
import { groupZones } from '../../shared/game/zoneGroups'
import { isZoneKey, spreadColors, suggestColor, zoneColor } from '../../shared/game/zoneColors'
import { RAID_ZONE_NAME_MAX as NAME_MAX, zoneNameKey, type ListedZone } from '../../shared/game/zoneList'
import type { TabContext } from '../../shared/tabs/types'
import { ColorSelect } from '../../shared/ui/ColorSelect'
import '../../shared/ui/zoneColor.css'
import './Zones.css'

// The Zones page of Settings (Guild Leaders): every zone the guild has in one list, grouped like the drop list editor (dungeons, then raids by size), each with its
// color. The zones of the built-in drop lists just show up (their name and size are fixed, their color is yours); a zone is added here, with the color it carries on its
// loot chosen as it is made, and then it is there for the raid calendar (raids of 10, 20 and 40) and the drop lists (ticked into a phase in Edit the drop lists).
// A zone made here is kept with the drop lists (guildTables.ts) in the current phase, audited like every drop list change; a zone of the older raid zone list can
// still be renamed, resized and removed. One document holds the colors (zoneColors.ts); a pick writes only that zone.
const sizes = [5, 10, 20, 25, 40]
const raidSizes: RaidSize[] = [10, 20, 40]
const kindOptions: { value: ZoneKind; label: string }[] = [{ value: 'dungeon', label: 'Dungeon' }, { value: 'raid', label: 'Raid' }]
const describe = (zone: { kind: string; players: number }) => `${zone.players}-player ${zone.kind}`

export function ZonesPanel({ ctx }: { ctx: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = ctx.feedback
  const zones = ctx.data.zoneList
  const chosen = ctx.data.zoneColors
  const who = { uid: ctx.identity.uid, displayName: ctx.identity.displayName }
  const colorOf = (zone: ListedZone) => zoneColor(zone.key, chosen)
  const groups = useMemo(() => groupZones(zones), [zones])
  const withChoice = zones.filter((zone) => chosen[zone.key] !== undefined)
  const withoutChoice = zones.filter((zone) => chosen[zone.key] === undefined && isZoneKey(zone.key))

  async function run(change: () => Promise<void>, done: string, failed = 'Could not save the zone.'): Promise<boolean> {
    setBusy(true)
    try {
      await change()
      setMutationError('')
      setNotice(done)
      return true
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : failed)
      return false
    } finally {
      setBusy(false)
    }
  }
  // A pick of the color a zone already has changes nothing, so nothing is written (and a first write is never a bare "take a choice away", which the rules refuse).
  const pick = async (zone: ListedZone, color: string) => {
    if (color.toLowerCase() === colorOf(zone)) return
    await run(() => saveZoneColor(zone.key, color, who), `${zone.name} has a new color.`)
  }

  return <section className="settings-section zones-panel">
    <header>
      <h3>Zones</h3>
      <p>Every dungeon and raid the guild uses, each with a color shown as a bar on its loot priorities, in Browse drops and in Edit the drop lists. The zones that come with the app show up here on their own; add any other below. A raid of 10, 20 or 40 can be scheduled in the Raid Calendar. Every zone except the ones marked as from the older raid zone list is ticked into the phases that use it in Edit the drop lists.</p>
    </header>
    <AddZone ctx={ctx} zones={zones} chosen={chosen} run={run} />
    {groups.map((group) => <details key={group.key} className="zones-group" open>
      <summary><span>{group.label}</span><small>{group.zones.length}</small></summary>
      <ul className="zones-list">
        {group.zones.map((zone) => <ZoneRow key={zone.key} zone={zone} zones={zones} color={colorOf(zone)} isChosen={chosen[zone.key] !== undefined} ctx={ctx} busy={busy} run={run} onPick={(color) => void pick(zone, color)} onReset={() => void run(() => saveZoneColor(zone.key, null, who), `${zone.name} has its automatic color again.`)} />)}
      </ul>
    </details>)}
    {zones.length === 0 && <p className="zones-empty">There are no zones yet. Add one above.</p>}
    <div className="zones-footer">
      <button type="button" className="button button-secondary" disabled={busy || withoutChoice.length === 0}
        title="Gives each zone that has no color chosen a color of its own, one no other zone has while the palette lasts" onClick={() => void run(() => saveZoneColors(spreadColors(withoutChoice.map((zone) => zone.key), withChoice.map(colorOf)), who), 'Every zone has a color of its own.')}>Give each zone its own color</button>
      {withChoice.length > 0 && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(() => clearZoneColors(who), 'Every zone has its automatic color again.')}>Use the automatic color for every zone</button>}
    </div>
  </section>
}

type Run = (change: () => Promise<void>, done: string, failed?: string) => Promise<boolean>

// A new zone: its name, kind and size, and the color it carries, chosen now (the first color no zone has yet is offered).
function AddZone({ ctx, zones, chosen, run }: { ctx: TabContext; zones: ListedZone[]; chosen: Record<string, string>; run: Run }) {
  const { busy } = ctx.feedback
  const inUse = zones.map((zone) => zoneColor(zone.key, chosen))
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ZoneKind>('raid')
  const [players, setPlayers] = useState(40)
  const [color, setColor] = useState<string | undefined>(undefined)
  const offered = color ?? suggestColor(inUse)
  const duplicate = zones.some((zone) => zoneNameKey(zone.name) === zoneNameKey(name))
  const ready = hasText(name) && name.trim().length <= NAME_MAX && !duplicate

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready) return
    const taken = [...zones.flatMap((zone) => (zone.zoneId === undefined ? [] : [zone.zoneId])), ...ctx.data.lootTables.flatMap((doc: LootTableDoc) => (doc.type === 'phase' ? [] : [doc.zoneId]))]
    const made = addZone({ name, kind, players }, taken, currentPhaseNo(ctx.data.settings))
    const added = await run(async () => {
      await writeLootTables([made.write], { uid: ctx.identity.uid, displayName: ctx.identity.displayName })
      await saveZoneColors({ [String(made.zoneId)]: offered }, { uid: ctx.identity.uid })
    }, `${name.trim()} was added.`, 'Could not add the zone.')
    if (added) { setName(''); setColor(undefined) }
  }

  return <form className="zones-add" onSubmit={(event) => void submit(event)}>
    <h4>Add a zone</h4>
    <div className="zones-add-fields">
      <label className="settings-field">Zone name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={NAME_MAX} disabled={busy} aria-invalid={duplicate} /></label>
      <label className="settings-field">Kind<select value={kind} onChange={(event) => { const next = event.target.value as ZoneKind; setKind(next); setPlayers(next === 'dungeon' ? 5 : 40) }} disabled={busy}>{kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="settings-field">Players<select value={players} onChange={(event) => setPlayers(Number(event.target.value))} disabled={busy}>{sizes.map((size) => <option key={size} value={size}>{size}-player</option>)}</select></label>
      <div className="settings-field">Color<ColorSelect value={offered} label="Color of the new zone" disabled={busy} onChange={setColor} /></div>
      <button className="button button-primary" disabled={busy || !ready}><Plus size={14} /> Add the zone</button>
    </div>
    {duplicate && <p className="zones-note" role="status">A zone called {name.trim()} is there already.</p>}
  </form>
}

function ZoneRow({ zone, zones, color, isChosen, ctx, busy, run, onPick, onReset }: { zone: ListedZone; zones: ListedZone[]; color: string; isChosen: boolean; ctx: TabContext; busy: boolean; run: Run; onPick: (color: string) => void; onReset: () => void }) {
  return <li className="zones-row" style={{ '--zone-color': color } as CSSProperties}>
    {zone.source === 'built-in'
      ? <div className="zones-name"><span className="zone-dot">{zone.name}</span><small>{describe(zone)}, comes with the app</small></div>
      // The fields start from what is stored and start again when it changes (a rename by another leader, say), so a Save never writes back a value nobody typed.
      : zone.source === 'guild' ? <GuildZoneFields key={`${zone.key}|${zone.name}|${zone.kind}|${zone.players}`} zone={zone} zones={zones} ctx={ctx} busy={busy} run={run} /> : <OlderZoneFields key={`${zone.key}|${zone.name}|${zone.players}`} zone={zone} busy={busy} run={run} />}
    <div className="zones-color">
      <ColorSelect value={color} label={`Color of ${zone.name}`} disabled={busy} onChange={onPick} />
      {isChosen && <button type="button" className="button button-secondary zones-reset" disabled={busy} onClick={onReset}>Use the automatic color</button>}
    </div>
  </li>
}

// A zone made in Settings: renamed, given another kind or size, written to the drop lists in the phase it is made in (a rename counts from that phase on).
function GuildZoneFields({ zone, zones, ctx, busy, run }: { zone: ListedZone; zones: ListedZone[]; ctx: TabContext; busy: boolean; run: Run }) {
  const [name, setName] = useState(zone.name)
  const [kind, setKind] = useState<ZoneKind>(zone.kind)
  const [players, setPlayers] = useState(zone.players)
  const duplicate = zones.some((other) => other.key !== zone.key && zoneNameKey(other.name) === zoneNameKey(name))
  const write = zone.zone && !duplicate && name.trim().length <= NAME_MAX ? editZone(zone.zone, { name, kind, players }) : null
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (write) void run(() => writeLootTables([write], { uid: ctx.identity.uid, displayName: ctx.identity.displayName }), `${name.trim()} was changed.`)
  }
  return <form className="zones-fields" onSubmit={save}>
    <label className="settings-field">Zone name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={NAME_MAX} disabled={busy} aria-invalid={duplicate} />{duplicate && <small className="zones-note">A zone called {name.trim()} is there already.</small>}</label>
    <label className="settings-field">Kind<select value={kind} onChange={(event) => setKind(event.target.value as ZoneKind)} disabled={busy}>{kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    <label className="settings-field">Players<select value={players} onChange={(event) => setPlayers(Number(event.target.value))} disabled={busy}>{sizes.map((size) => <option key={size} value={size}>{size}-player</option>)}</select></label>
    <button className="button button-secondary" disabled={busy || !write}><Save size={14} /> Save</button>
  </form>
}

// A zone of the older raid zone list (the raid calendar's own): renamed, resized and removed as before.
function OlderZoneFields({ zone, busy, run }: { zone: ListedZone; busy: boolean; run: Run }) {
  const id = zone.catalogId ?? ''
  const [name, setName] = useState(zone.name)
  const [size, setSize] = useState(zone.players as RaidSize)
  const changed = name.trim() !== zone.name || size !== zone.players
  const save = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (name.trim()) void run(async () => { await saveRaidZone({ name: name.trim(), size }, id) }, `${name.trim()} was changed.`) }
  return <form className="zones-fields" onSubmit={save}>
    <label className="settings-field">Zone name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={NAME_MAX} required disabled={busy} /></label>
    <label className="settings-field">Players<select value={size} onChange={(event) => setSize(Number(event.target.value) as RaidSize)} disabled={busy}>{raidSizes.map((option) => <option key={option} value={option}>{option}-player</option>)}</select></label>
    <button className="button button-secondary" disabled={busy || !changed || !name.trim()}><Save size={14} /> Save</button>
    <button type="button" className="button button-secondary" disabled={busy} aria-label={`Remove ${zone.name}`}
      onClick={() => void run(() => deleteRaidZone(id), `${zone.name} was removed. Raids already scheduled keep their saved zone details.`)}><Trash2 size={14} /> Remove</button>
    <small className="zones-older">From the older raid zone list</small>
  </form>
}
