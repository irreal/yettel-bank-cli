/**
 * `yettel transactions <accountNumber>` — shapes confirmed from a real session.
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
    pageSize?: string;
    amountFrom?: string;
    amountTo?: string;
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
    pageSize: opts.pageSize ? Number(opts.pageSize) : undefined,
    amountFrom: opts.amountFrom ? Number(opts.amountFrom) : undefined,
    amountTo: opts.amountTo ? Number(opts.amountTo) : undefined,
  };

  try {
    const data = await getTransactions(session, accountNumber, query);
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    for (const t of data.transactions ?? []) {
      const date = (t.transactionTime ?? t.valueDate ?? "").slice(0, 10);
      const sign = t.direction === "d" ? "-" : "+";
      const amt = `${sign}${t.amount.toFixed(2)} ${t.currency}`;
      const who = t.counterParty?.name ?? t.transactionCodeDescription ?? "";
      console.log(`${date}  ${amt.padStart(16)}  ${who}  ${t.description ?? ""}`.trimEnd());
    }
    console.log(`\nPage ${data.page + 1} of ${data.totalPages} (${data.totalCount} transactions)`);
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
