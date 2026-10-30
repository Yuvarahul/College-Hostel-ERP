/* ============================================================
   asyncLock.js
   NEW FILE — added for the Gatekeeper dynamic QR workflow.

   The CSV data layer (csvService.js) does plain "read whole file,
   modify in memory, rewrite whole file" — there is no row-level
   locking or transaction support. Two requests that both read the
   file before either writes back (e.g. two devices scanning the
   same return QR at the same moment) can otherwise both see the
   token as ACTIVE and both "succeed".

   withLock(key, fn) chains callers for the same key into a single
   queue, so only one read-modify-write for a given file runs at a
   time within this Node process — giving us an atomic
   check-then-flip for QR redemption without changing the storage
   engine.

   Scope/limits (documented rather than hidden): this is a
   single-process, in-memory mutex. It is sufficient for this
   project (one Node process, CSV storage) but would NOT coordinate
   across multiple server instances/processes — a real database
   transaction (or a distributed lock such as Redis) would be
   needed if this app were ever run behind a multi-instance/cluster
   deployment.
   ============================================================ */

const chains = new Map();

/**
 * Run fn() exclusively for the given key: if another call for the
 * same key is in-flight, this call waits for it to finish first.
 */
function withLock(key, fn) {
    const prevChain = chains.get(key) || Promise.resolve();
    const nextChain = prevChain.then(fn, fn).finally(() => {
        if (chains.get(key) === nextChain) {
            chains.delete(key);
        }
    });
    chains.set(key, nextChain);
    return nextChain;
}

module.exports = { withLock };
