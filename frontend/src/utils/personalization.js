// Admin-authored messages can address each recipient by their display name
// with the ${user} placeholder. The admin preview uses a sample because the
// real value is only known when the reader's boot payload is built.
export const USER_PLACEHOLDER = '${user}';

export function previewUserPlaceholder(text, sample = 'Aisha') {
  return String(text == null ? '' : text).replace(/\$\{user\}/g, sample);
}

// Instagram's split, used everywhere a person is listed: the friendly name
// leads and the unique handle rides beside it. The server already resolved
// `displayName` with a username fallback, so older payloads still work.
export function personName(entry) {
  return (entry && (entry.displayName || entry.name || entry.username)) || '';
}

// Empty when the name *is* the handle (an account that never chose a name), so
// a label never reads "aisha @aisha".
export function personHandle(entry) {
  if (!entry || !entry.username) return '';
  return personName(entry) === entry.username ? '' : `@${entry.username}`;
}
