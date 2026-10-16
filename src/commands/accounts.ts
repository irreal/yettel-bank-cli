/**
 * `yettel accounts` / `yettel balances` / `yettel account <number>`.
 * Response shapes confirmed from a real logged-in session.
 */
import {
  getAccountsOverview,
  getAccountDetail,
  ApiError,
  type Account,
  type Balance,
} from "../api.js";
import { loadSession, isLoggedIn } from "../storage.js";

function fmt(b: Balance): string {
  const sign = b.direction === "d" ? "-" : "";
  return `${sign}${b.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${b.currency}`;
}

function balanceOf(a: Account): string {
  if (!a.balances?.length) return "(none)";
  return a.balances.map((b) => `${fmt(b)} [${b.balanceKind}]`).join(", ");
}

export async function accountsCommand(opts: { json?: boolean }): Promise<void> {
  const session = loadSession();
  if (!isLoggedIn(session)) {
    console.error("Not logged in. Run `yettel login` first.");
    process.exitCode = 1;
    return;
  }
  try {
    const data = await getAccountsOverview(session);
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    for (const a of data.accounts ?? []) {
      console.log(`${a.accountNumber}  ${a.currency}  ${a.accountName ?? a.accountType ?? ""}  ${a.status ?? ""}`);
      console.log(`    ${balanceOf(a)}`);
    }
  } catch (err) {
    reportError(err);
  }
}

export async function balancesCommand(opts: { json?: boolean }): Promise<void> {
  const session = loadSession();
  if (!isLoggedIn(session)) {
    console.error("Not logged in. Run `yettel login` first.");
    process.exitCode = 1;
    return;
  }
  try {
    const data = await getAccountsOverview(session);
    const rows = (data.accounts ?? []).map((a) => ({
      accountNumber: a.accountNumber,
      currency: a.currency,
      balances: a.balances,
    }));
    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    for (const a of data.accounts ?? []) {
      console.log(`${a.accountNumber}  ${balanceOf(a)}`);
    }
  } catch (err) {
    reportError(err);
  }
}

export async function accountDetailCommand(
  accountNumber: string,
  opts: { json?: boolean; currency?: string },
): Promise<void> {
  const session = loadSession();
  if (!isLoggedIn(session)) {
    console.error("Not logged in. Run `yettel login` first.");
    process.exitCode = 1;
    return;
  }
  try {
    const a = await getAccountDetail(session, accountNumber, opts.currency ?? "RSD");
    if (opts.json) {
      console.log(JSON.stringify(a, null, 2));
      return;
    }
    console.log(`${a.accountNumber}  ${a.currency}  ${a.productName ?? a.accountName ?? ""}`);
    console.log(`  IBAN:     ${a.iban ?? "-"}`);
    console.log(`  Status:   ${a.status ?? "-"}`);
    console.log(`  Balance:  ${balanceOf(a)}`);
  } catch (err) {
    reportError(err);
  }
}

function reportError(err: unknown): void {
  if (err instanceof ApiError) {
    console.error(`Request failed: ${err.message}`);
    if (err.status === 401) {
      console.error("Token may have expired. Run `yettel login` again.");
    }
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
}
