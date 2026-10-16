#!/usr/bin/env node
import { Command } from "commander";
import { runLogin } from "./login.js";
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
  .description("Show whether a session is stored and for whom")
  .action(() => {
    const s = loadSession();
    if (!isLoggedIn(s)) {
      console.log("Not logged in. Run `yettel login`.");
      return;
    }
    console.log(`Logged in. Session file: ${sessionPath()}`);
    console.log(`  partyId:    ${s.partyId ?? "(unknown)"}`);
    console.log(`  customerId: ${s.customerId ?? "(unknown)"}`);
    if (s.loginTime) console.log(`  loginTime:  ${new Date(s.loginTime).toISOString()}`);
    console.log(`  clientToken: ${s.clientToken ? "present" : "missing"}`);
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
