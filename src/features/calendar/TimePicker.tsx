import { useEffect, useRef, useState } from 'react'

const HOURS = Array.from({ length: 12 }, (_, index) => index + 1)
const PERIODS = ['AM', 'PM'] as const
const ITEM_HEIGHT = 30

function parts(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return { hour: hours % 12 || 12, minute: minutes, period: hours < 12 ? 'AM' : 'PM' } as const
}

function toTime(hour: number, minute: number, period: 'AM' | 'PM') {
  const hours = (hour % 12) + (period === 'PM' ? 12 : 0)
  return `${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function Column<T extends string | number>({ label, items, value, format, onPick }: { label: string; items: readonly T[]; value: T; format: (item: T) => string; onPick: (item: T) => void }) {
  const list = useRef<HTMLDivElement>(null)
  const firstRun = useRef(true)
  const index = items.indexOf(value)

  // The chosen item sits at the top of its column, with a spacer below so even the last item can reach the top.
  useEffect(() => {
    list.current?.scrollTo({ top: index * ITEM_HEIGHT, behavior: firstRun.current ? 'auto' : 'smooth' })
    firstRun.current = false
  }, [index])
  return <div className="time-picker-column" role="listbox" aria-label={label} ref={list} style={{ height: ITEM_HEIGHT * 5 }}>
    {items.map((item) => <button type="button" role="option" aria-selected={item === value} className={item === value ? 'selected' : ''} style={{ height: ITEM_HEIGHT }} onClick={() => onPick(item)} key={item}>{format(item)}</button>)}
    <div className="time-picker-spacer" style={{ height: ITEM_HEIGHT * 4 }} aria-hidden="true" />
  </div>
}

export function TimePicker({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [time, setTime] = useState(defaultValue)
  const { hour, minute, period } = parts(time)
  const minutes = Array.from({ length: 12 }, (_, index) => index * 5)
  if (!minutes.includes(minute)) minutes.push(minute)
  minutes.sort((a, b) => a - b)

  return <div className="time-picker" role="group" aria-label="Start time (ET)">
    <input type="hidden" name={name} value={time} />
    <Column label="Hour" items={HOURS} value={hour} format={String} onPick={(next) => setTime(toTime(next, minute, period))} />
    <Column label="Minute" items={minutes} value={minute} format={(item) => String(item).padStart(2, '0')} onPick={(next) => setTime(toTime(hour, next, period))} />
    <Column label="AM or PM" items={PERIODS} value={period} format={String} onPick={(next) => setTime(toTime(hour, minute, next))} />
  </div>
}
