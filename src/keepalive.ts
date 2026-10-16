/** Session keep-alive helpers (used by `yettel keepalive` and `yettel mcp`). */
import { refreshSession, SessionExpiredError, SESSION_EXPIRED_MSG } from "./api.js";
import { loadSession, isLoggedIn } from "./storage.js";

export const DEFAULT_INTERVAL_S = 240; // access token lives 299s
export const MAX_INTERVAL_S = 280;

export type RefreshOutcome = "ok" | "expired" | "error";

/** One refresh attempt. Never logs tokens. */
export async function refreshOnce(): Promise<{ outcome: RefreshOutcome; message: string }> {
  const s = loadSession();
  if (!isLoggedIn(s) || !s.refreshToken) return { outcome: "expired", message: "Not logged in. Run `yettel login`." };
  try {
    await refreshSession(s, { force: true });
    return { outcome: "ok", message: "ok" };
  } catch (err) {
    if (err instanceof SessionExpiredError) return { outcome: "expired", message: SESSION_EXPIRED_MSG };
    const status = (err as { status?: number }).status;
    return { outcome: "error", message: `refresh failed${status ? ` (HTTP ${status})` : ""}: ${err instanceof Error && !status ? err.message : "temporary error"}` };
  }
}

/**
 * Background refresher for long-running servers. Timer is unref'd so it never
 * keeps the process alive. Skips a tick if the session was refreshed recently
 * (e.g. by a sibling process or a 401 retry).
 */
export function startKeepAliveTimer(intervalS = DEFAULT_INTERVAL_S, log: (m: string) => void = (m) => console.error(m)): NodeJS.Timeout {
  const ms = Math.min(intervalS, MAX_INTERVAL_S) * 1000;
  const t = setInterval(async () => {
    const last = loadSession().lastRefreshAt ?? 0;
    if (Date.now() - last < ms / 2) return;
    const r = await refreshOnce();
    if (r.outcome !== "ok") log(`[keepalive] ${r.message}`);
  }, ms);
  t.unref();
  return t;
}
