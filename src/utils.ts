// ─────────────────────────────────────────────────────────────
//  Shared utility helpers used across the codebase.
// ─────────────────────────────────────────────────────────────

/**
 * Wraps a promise with a hard timeout. If the timeout fires, `onTimeout`
 * is called so the caller can forcibly tear down whatever the promise
 * was waiting on (e.g. destroy a stuck socket, abandon a stuck DB call).
 * A plain `setTimeout` rejection alone does NOT cancel the underlying
 * operation — it just stops *waiting* for it — so `onTimeout` gives
 * callers a chance to actually cancel/cleanup the dangling work so it
 * can't keep blocking resources (sockets, connections, event loop).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      reject(new Error(`Timed out after ${ms}ms: ${label}`));
    }, ms);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}
