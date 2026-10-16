/**
 * `yettel accounts` / `yettel balances` — PHASE 2 PLACEHOLDERS.
 *
 * The endpoint and known field names come from the public bundle, but the exact
 * response envelope is unconfirmed. Capture a HAR after login (see README) and
 * finish the mapping where marked TODO.
 */
import { getAccountsOverview, ApiError } from "../api.js";
import { loadSession, isLoggedIn } from "../storage.js";

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
    // TODO(phase 2): map the confirmed envelope into a table of
    // accountNumber / accountName / availableBalance / currency.
    console.log(
      "Accounts fetched. Response shape not yet mapped — showing raw JSON.\n" +
        "Use --json, or capture a HAR and finish the mapper (see README).\n",
    );
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    reportError(err);
  }
}

export async function balancesCommand(opts: { json?: boolean }): Promise<void> {
  // Balances live inside the accounts-overview payload (availableBalance /
  // currentBalance per account), so this reuses the same endpoint for now.
  console.log(
    "Balances are part of the accounts-overview payload. Showing raw data; " +
      "finish the balance mapping once a HAR confirms the shape.\n",
  );
  await accountsCommand(opts);
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
