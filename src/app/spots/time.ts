/**
 * "10:19" for a moment, in the student's own clock, 12 hour without am/pm (as in the design).
 * An unreadable value gives "".
 */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")}`;
}
