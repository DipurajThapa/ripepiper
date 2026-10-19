/** Booking availability: 15-minute calls in business hours (Gulf Standard Time), minus busy times. */

export const BOOKING = {
  tzOffsetMinutes: 240,          // Asia/Dubai, UTC+4, no daylight saving
  days: [1, 2, 3, 4, 5],         // Monday to Friday (UAE working week)
  startHour: 10, endHour: 17,    // first slot 10:00, last slot ends by 17:00
  durationMin: 15,
  bufferMin: 15,                 // gap after each call
  minNoticeMin: 120,             // no booking less than 2 hours ahead
  horizonDays: 14,
};

export interface Busy { start: Date; end: Date }
export interface Slot { start: string; end: string; label: string }

const pad = (n: number) => String(n).padStart(2, "0");

/** Returns free slots between now and the booking horizon. `busy` comes from Google Calendar free/busy plus booked meetings. */
export function freeSlots(now: Date, busy: Busy[], cfg = BOOKING): Slot[] {
  const out: Slot[] = [];
  const off = cfg.tzOffsetMinutes * 60_000;
  const earliest = now.getTime() + cfg.minNoticeMin * 60_000;
  const localNow = new Date(now.getTime() + off);
  for (let d = 0; d <= cfg.horizonDays; d++) {
    const day = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + d));
    if (!cfg.days.includes(day.getUTCDay())) continue;
    for (let m = cfg.startHour * 60; m + cfg.durationMin <= cfg.endHour * 60; m += cfg.durationMin + cfg.bufferMin) {
      const startUtc = day.getTime() + m * 60_000 - off;
      const endUtc = startUtc + cfg.durationMin * 60_000;
      if (startUtc < earliest) continue;
      const clash = busy.some(b => startUtc < b.end.getTime() + cfg.bufferMin * 60_000 && endUtc > b.start.getTime() - cfg.bufferMin * 60_000);
      if (clash) continue;
      const local = new Date(startUtc + off);
      out.push({
        start: new Date(startUtc).toISOString(),
        end: new Date(endUtc).toISOString(),
        label: `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][local.getUTCDay()]} ${local.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][local.getUTCMonth()]}, ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} GST`,
      });
    }
  }
  return out;
}

export function isOfferedSlot(startIso: string, now: Date, busy: Busy[]): Slot | null {
  return freeSlots(now, busy).find(s => s.start === new Date(startIso).toISOString()) ?? null;
}

/** Which reminders are due now. Runs every 5 minutes from the cron trigger. */
export function dueReminder(start: Date, now: Date, sent24: boolean, sent1: boolean): "24h" | "1h" | null {
  const mins = (start.getTime() - now.getTime()) / 60_000;
  if (mins <= 0) return null;
  if (!sent1 && mins <= 65) return "1h";
  if (!sent24 && mins <= 24 * 60 + 5 && mins > 65) return "24h";
  return null;
}
