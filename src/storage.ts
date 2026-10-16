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

export function saveSession(session: Session): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = sessionPath();
  writeFileSync(p, JSON.stringify(session, null, 2), { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* best effort on platforms without POSIX perms */
  }
}

export function clearSession(): void {
  const p = sessionPath();
  if (existsSync(p)) rmSync(p);
}

export function isLoggedIn(session: Session = loadSession()): boolean {
  return Boolean(session.accessToken);
}
