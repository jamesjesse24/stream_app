function replaceRequired(source, name, original, replacement) {
  if (source.includes(replacement)) return source;
  const patched = source.replace(original, replacement);
  if (patched === source) {
    throw new Error(`Could not locate the expected ${name} block.`);
  }
  return patched;
}

function patchStreamLifecycleCompatibility(source) {
  let patched = source;
  patched = replaceRequired(
    patched,
    'session map iteration',
    '  for (const session of store.sessions.values()) {',
    '  for (const session of Array.from(store.sessions.values())) {',
  );
  patched = replaceRequired(
    patched,
    'client map iteration',
    '    for (const [clientId, lastSeen] of session.clients) {',
    '    for (const [clientId, lastSeen] of Array.from(session.clients.entries())) {',
  );
  return patched;
}

module.exports = { patchStreamLifecycleCompatibility };
