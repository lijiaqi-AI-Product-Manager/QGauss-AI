/** Recover an accepted creative request; reading never sends it again. */
export function creationIntent(family, owner, validPayload, storage = sessionStorage, quoted = true) {
  const key = 'qg:' + family + ':intent:' + owner;
  return {
    read() {
      try {
        const value = JSON.parse(storage.getItem(key));
        return value && /^[A-Za-z0-9_-]{8,100}$/.test(value.requestKey) && (!quoted || /^[a-f0-9]{64}$/.test(value.quoteRevision)) && validPayload(value.payload) ? value : null;
      } catch { return null; }
    },
    save(value) { try { storage.setItem(key, JSON.stringify(value)); } catch {} },
    clear() { try { storage.removeItem(key); } catch {} },
  };
}
