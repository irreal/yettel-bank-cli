/**
 * Local session storage. The web app keeps these in the browser's localStorage;
 * this CLI keeps them in a single JSON file in the user's config dir, created
 * with 0600 permissions. NEVER commit this file. See README security notes.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  chmodSync,
  renameSync,
  openSync,
  closeSync,
  statSync,
} from "node:fs";

export interface Session {
  /** JWT access token (web app: localStorage `b4fToken`). */
  accessToken?: string;
  /** Refresh token (web app: `b4fRefreshToken`). */
  refreshToken?: string;
  /** McApi client token (web app: `clientToken`). */
  clientToken?: string;
  /** JWT `customerId` claim (web app: `partyId`). */
  partyId?: string;
  /** JWT `experienceId` claim (web app: `customerId`). */
  customerId?: string;
  /** Epoch ms of login. */
  loginTime?: number;
  /** Epoch ms of the last successful token refresh. */
  lastRefreshAt?: number;
}

export function configDir(): string {
  if (process.env.YETTEL_CLI_HOME?.trim()) {
    return process.env.YETTEL_CLI_HOME.trim();
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg || join(homedir(), ".config");
  return join(base, "yettel-cli");
}

export function sessionPath(): string {
  return join(configDir(), "session.json");
}

export function loadSession(): Session {
  const p = sessionPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Session;
  } catch {
    return {};
  }
}

/** Atomic write: temp file in the same dir, then rename. */
export function saveSession(session: Session): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = sessionPath();
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(session, null, 2), { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* best effort on platforms without POSIX perms */
  }
  renameSync(tmp, p);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cross-process lock (lock file created with O_EXCL). Stale locks (>30s) are
 * broken. Used around read-refresh-write so concurrent processes sharing the
 * session file never clobber each other's rotated refresh token.
 */
export async function withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, "session.lock");
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx", 0o600));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) rmSync(lock, { force: true });
      } catch {
        /* raced with release */
      }
      if (Date.now() > deadline) throw new Error("Timed out waiting for session lock.");
      await sleep(100 + Math.random() * 100);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

export function clearSession(): void {
  const p = sessionPath();
  if (existsSync(p)) rmSync(p);
}

export function isLoggedIn(session: Session = loadSession()): boolean {
  return Boolean(session.accessToken);
}
