/**
 * `yettel transactions <accountNumber>` — PHASE 2 PLACEHOLDER.
 *
 * Endpoint and raw item field names come from the public bundle
 * (TransactionsList.api/mapper). Response envelope (paging) is unconfirmed —
 * finish once a HAR is available (see README).
 */
import { getTransactions, ApiError, type TransactionsQuery } from "../api.js";
import { loadSession, isLoggedIn } from "../storage.js";

export async function transactionsCommand(
  accountNumber: string,
  opts: {
    json?: boolean;
    currency?: string;
    page?: string;
    from?: string;
    to?: string;
    search?: string;
  },
): Promise<void> {
  const session = loadSession();
  if (!isLoggedIn(session)) {
    console.error("Not logged in. Run `yettel login` first.");
    process.exitCode = 1;
    return;
  }
  if (!accountNumber) {
    console.error("Usage: yettel transactions <accountNumber> [options]");
    process.exitCode = 1;
    return;
  }

  const query: TransactionsQuery = {
    currency: opts.currency,
    page: opts.page ? Number(opts.page) : 0,
    dateFrom: opts.from,
    dateTo: opts.to,
    search: opts.search,
  };

  try {
    const data = await getTransactions(session, accountNumber, query);
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    // TODO(phase 2): map transactions[] → date / counterParty.name / amount /
    // currency / direction table once a HAR confirms the envelope + paging.
    console.log(
      "Transactions fetched. Response shape not yet mapped — showing raw JSON.\n",
    );
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`Request failed: ${err.message}`);
      if (err.status === 401) console.error("Run `yettel login` again.");
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exitCode = 1;
  }
}
