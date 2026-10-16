#!/usr/bin/env node
import { Command } from "commander";
import { runLogin } from "./login.js";
import { refreshOnce, DEFAULT_INTERVAL_S, MAX_INTERVAL_S } from "./keepalive.js";
import { accountsCommand, balancesCommand, accountDetailCommand } from "./commands/accounts.js";
import { transactionsCommand } from "./commands/transactions.js";
import {
  loadSession,
  clearSession,
  sessionPath,
  isLoggedIn,
} from "./storage.js";

const program = new Command();

program
  .name("yettel")
  .description(
    "Owner-authorized personal CLI for Yettel Bank (Serbia) e-banking.\n" +
      "QR login, accounts, balances and transactions (read-only).",
  )
  .version("0.1.0");

program
  .command("login")
  .description("Start the QR login flow and store the session locally")
  .option("--max-attempts <n>", "QR regeneration attempts before giving up", "5")
  .option("--show-payload", "also print the raw operationId behind the QR", false)
  .action(async (opts) => {
    try {
      await runLogin({
        maxAttempts: Number(opts.maxAttempts),
        showPayload: Boolean(opts.showPayload),
      });
    } catch (err) {
      console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Show session age, last refresh and validity (no tokens printed)")
  .option("--check", "attempt a refresh to verify the session is currently valid", false)
  .action(async (opts) => {
    const s = loadSession();
    if (!isLoggedIn(s)) {
      console.log("Not logged in. Run `yettel login`.");
      process.exitCode = 1;
      return;
    }
    const ago = (t?: number) => {
      if (!t) return "unknown";
      const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
      const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
      return `${d ? d + "d " : ""}${h ? h + "h " : ""}${m}m ago (${new Date(t).toISOString()})`;
    };
    console.log(`Session file:  ${sessionPath()}`);
    console.log(`Login:         ${ago(s.loginTime)}`);
    console.log(`Last refresh:  ${ago(s.lastRefreshAt)}`);
    console.log(`Refresh token: ${s.refreshToken ? "present" : "missing"}`);
    if (!opts.check) {
      console.log("Valid:         not checked (use --check to attempt a refresh)");
      return;
    }
    const r = await refreshOnce();
    console.log(`Valid:         ${r.outcome === "ok" ? "yes" : r.outcome === "expired" ? "no - run `yettel login`" : "unknown - " + r.message}`);
    if (r.outcome !== "ok") process.exitCode = 1;
  });

program
  .command("keepalive")
  .description("Refresh the stored session (keeps you logged in). --loop <seconds> to run as a daemon")
  .option("--loop [seconds]", `repeat every N seconds (default ${DEFAULT_INTERVAL_S} when no value; max ${MAX_INTERVAL_S})`)
  .action(async (opts) => {
    const stamp = () => new Date().toISOString();
    const once = async () => {
      const r = await refreshOnce();
      console.log(`${stamp()} ${r.outcome === "ok" ? "ok" : r.message}`);
      return r.outcome;
    };
    if (opts.loop === undefined) {
      const o = await once();
      if (o !== "ok") process.exitCode = 1;
      return;
    }
    const n = opts.loop === true ? DEFAULT_INTERVAL_S : Number(opts.loop);
    if (!Number.isFinite(n) || n < 5) {
      console.error("--loop must be a number of seconds >= 5");
      process.exitCode = 1;
      return;
    }
    const interval = Math.min(n, MAX_INTERVAL_S);
    if (interval !== n) console.log(`${stamp()} interval capped to ${interval}s (access token lives 299s)`);
    for (;;) {
      const o = await once();
      if (o === "expired") {
        process.exitCode = 1;
        return;
      }
      await new Promise((r) => setTimeout(r, interval * 1000));
    }
  });

program
  .command("logout")
  .description("Delete the stored session file")
  .action(() => {
    clearSession();
    console.log("Session cleared.");
  });

program
  .command("accounts")
  .description("List accounts")
  .option("--json", "print raw JSON", false)
  .action((opts) => accountsCommand(opts));

program
  .command("account")
  .argument("<accountNumber>", "account number")
  .description("Show details for one account")
  .option("--json", "print raw JSON", false)
  .option("--currency <code>", "currency", "RSD")
  .action((n, opts) => accountDetailCommand(n, opts));

program
  .command("balances")
  .description("Show balances")
  .option("--json", "print raw JSON", false)
  .action((opts) => balancesCommand(opts));

program
  .command("transactions")
  .argument("<accountNumber>", "account number to list transactions for")
  .description("List recent transactions")
  .option("--json", "print raw JSON", false)
  .option("--currency <code>", "currency filter, e.g. RSD")
  .option("--page <n>", "0-based page index", "0")
  .option("--from <iso>", "date-from (ISO)")
  .option("--to <iso>", "date-to (ISO)")
  .option("--search <text>", "counterparty search")
  .option("--page-size <n>", "items per page", "10")
  .option("--amount-from <n>", "minimum amount")
  .option("--amount-to <n>", "maximum amount")
  .action((accountNumber, opts) => transactionsCommand(accountNumber, opts));

program
  .command("mcp")
  .description("Run the read-only MCP server (stdio by default, or --http)")
  .option("--http", "serve streamable HTTP at /mcp instead of stdio", false)
  .option("--host <host>", "HTTP bind address (default 127.0.0.1; use 0.0.0.0 to host publicly)", "127.0.0.1")
  .option("--port <n>", "HTTP port (default: $PORT or 8787)")
  .action(async (opts) => {
    try {
      const m = await import("./mcp.js");
      if (opts.http) {
        await m.runHttp({ host: opts.host, port: Number(opts.port ?? process.env.PORT ?? 8787) });
      } else {
        await m.runStdio();
      }
    } catch (err) {
      console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
