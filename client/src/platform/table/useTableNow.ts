import { useEffect, useState } from 'react';
import { nextEvent, type Timeline } from './timeline';

/**
 * The table's clock: the time to draw at, woken for each moment the drawing changes (nextEvent).
 * Every wake counts a tick and the next timer is set again from it, so a timer that fires a hair
 * before Date.now() reaches its moment (a busy machine, a wall clock stepped back) only waits a
 * little longer: the clock never stops mid-deal with every move left greyed out.
 */
export function useTableNow<T>(timeline: Timeline<T>): number {
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const current = Math.max(now, Date.now());
  const next = nextEvent(timeline, current);
  useEffect(() => {
    if (next === null) return;
    const id = setTimeout(
      () => {
        setNow((was) => Math.max(was, Date.now()));
        setTick((t) => t + 1);
      },
      Math.max(0, next - Date.now()) + 4,
    );
    return () => clearTimeout(id);
  }, [next, timeline, tick]);
  return current;
}
