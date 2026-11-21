// The calendar day the reader is actually in, as YYYY-MM-DD.
//
// `toISOString()` converts to UTC first: for anyone east of UTC that rolls the
// date back to yesterday between midnight and their offset (India at 00:30 is
// still 19:00 the previous day in UTC). Date fields and API payloads use this
// local key so "today" means today where the reader is standing.
export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
