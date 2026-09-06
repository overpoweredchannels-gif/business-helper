import assert from "node:assert/strict";
import { withSessionRetry, SESSION_EXPIRED_MESSAGE } from "../src/lib/supabase/session-retry";

async function main() {
  const session = { user: { id: "owner-1" } };
  const expired = { error: { code: "PGRST303", message: "JWT expired" } };
  const ok = { error: null };
  let refreshes = 0;
  let writes = 0;
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    refreshSession: async () => { refreshes++; return { data: { session }, error: null }; },
  };
  assert.equal(await withSessionRetry(auth, async () => (++writes === 1 ? expired : ok)), ok);
  assert.equal(writes, 2);
  assert.equal(refreshes, 1);
  writes = 0;
  await assert.rejects(withSessionRetry(auth, async () => { writes++; return expired; }), { message: SESSION_EXPIRED_MESSAGE });
  assert.equal(writes, 2, "Repeated expiry must not loop");
  for (const refreshed of [
    { data: { session: null }, error: new Error("Refresh expired") },
    { data: { session: { user: { id: "other-owner" } } }, error: null },
  ]) {
    writes = 0;
    await assert.rejects(withSessionRetry({ ...auth, refreshSession: async () => refreshed }, async () => { writes++; return expired; }));
    assert.equal(writes, 1, "No retry after failed refresh or account switch");
  }
  const denied = { error: { code: "42501", message: "Permission denied" } };
  const previous = refreshes;
  assert.equal(await withSessionRetry(auth, async () => denied), denied);
  assert.equal(await withSessionRetry(auth, async () => ok), ok);
  assert.equal(refreshes, previous, "No refresh for success or permission errors");
  writes = 0;
  await assert.rejects(withSessionRetry({ ...auth, getSession: async () => ({ data: { session: null }, error: null }) }, async () => { writes++; return ok; }));
  assert.equal(writes, 0);
  console.log("Session retry: expiry recovery, bounded retries, failed refresh, account switch and permission checks passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
