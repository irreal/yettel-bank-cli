/**
 * Read-only MCP server (`yettel mcp`). Exposes accounts, account detail and
 * transactions. There are deliberately NO write / payment tools.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getAccountsOverview, getAccountDetail, getTransactions } from "./api.js";
import { loadSession, isLoggedIn } from "./storage.js";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const LOGIN_MSG = "Not logged in or session expired. Run `yettel login` on the machine hosting this server.";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (v: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(v) }] });
const fail = (m: string): ToolResult => ({ content: [{ type: "text", text: m }], isError: true });

async function guarded(fn: () => Promise<unknown>): Promise<ToolResult> {
  const session = loadSession();
  if (!isLoggedIn(session)) return fail(LOGIN_MSG);
  try {
    return ok(await fn());
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403 || /refresh|login|unauthor/i.test(String((err as Error).message))) {
      return fail(LOGIN_MSG);
    }
    return fail(`Bank request failed${status ? ` (HTTP ${status})` : ""}.`);
  }
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "yettel-bank-cli", version: "0.1.0" });

  server.registerTool(
    "list_accounts",
    { description: "List all bank accounts with their balances (read-only).", inputSchema: {}, annotations: { title: "List accounts", ...RO } },
    async () =>
      guarded(async () => {
        const s = loadSession();
        const d = await getAccountsOverview(s);
        return (d.accounts ?? []).map((a) => ({
          accountNumber: a.accountNumber,
          currency: a.currency,
          name: a.accountName,
          type: a.accountType,
          status: a.status,
          balances: (a.balances ?? []).map((b) => ({
            kind: b.balanceKind,
            amount: b.direction === "d" ? -b.amount : b.amount,
            currency: b.currency,
          })),
        }));
      }),
  );

  server.registerTool(
    "get_account_detail",
    {
      description: "Get details (IBAN, SWIFT, product, status) of one account (read-only).",
      inputSchema: { account_number: z.string(), currency: z.string().optional().describe("Default RSD") },
      annotations: { title: "Account detail", ...RO },
    },
    async ({ account_number, currency }) =>
      guarded(() => getAccountDetail(loadSession(), account_number, currency ?? "RSD")),
  );

  server.registerTool(
    "get_transactions",
    {
      description: "List transactions of one account, newest first, paginated (read-only).",
      inputSchema: {
        account_number: z.string(),
        currency: z.string().optional(),
        page: z.number().int().min(0).optional().describe("0-based page"),
        page_size: z.number().int().min(1).max(100).optional(),
        amount_from: z.number().optional(),
        amount_to: z.number().optional(),
      },
      annotations: { title: "Transactions", ...RO },
    },
    async (a) =>
      guarded(() =>
        getTransactions(loadSession(), a.account_number, {
          currency: a.currency,
          page: a.page,
          pageSize: a.page_size ?? 20,
          amountFrom: a.amount_from,
          amountTo: a.amount_to,
        }),
      ),
  );

  return server;
}

export async function runStdio(): Promise<void> {
  await buildServer().connect(new StdioServerTransport());
}

function parseKeys(): string[] {
  const raw = [process.env.YETTEL_MCP_API_KEYS, process.env.YETTEL_MCP_TOKEN].filter(Boolean).join(",");
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

const digest = (s: string) => createHash("sha256").update(s).digest();
function keyValid(given: string, keys: string[]): boolean {
  const g = digest(given);
  let okAny = false;
  for (const k of keys) if (timingSafeEqual(g, digest(k))) okAny = true; // no early exit
  return okAny;
}

function isLocalHost(h: string): boolean {
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

export async function runHttp(opts: { host: string; port: number }): Promise<void> {
  const keys = parseKeys();
  if (keys.length === 0) {
    throw new Error("Refusing to start HTTP mode: set YETTEL_MCP_API_KEYS (or YETTEL_MCP_TOKEN).");
  }
  if (!isLocalHost(opts.host) && keys.some((k) => k.length < 32)) {
    throw new Error("Refusing to start on a non-localhost host: every API key must be at least 32 characters.");
  }

  // Failed-auth rate limit: 10 failures / minute / IP, then 429.
  const fails = new Map<string, { n: number; reset: number }>();
  const limited = (ip: string) => {
    const e = fails.get(ip);
    return !!e && e.reset > Date.now() && e.n >= 10;
  };
  const recordFail = (ip: string) => {
    const now = Date.now();
    const e = fails.get(ip);
    if (!e || e.reset <= now) fails.set(ip, { n: 1, reset: now + 60_000 });
    else e.n++;
    if (fails.size > 10_000) for (const [k, v] of fails) if (v.reset <= now) fails.delete(k);
  };

  const send = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === "/healthz") return send(res, 200, { status: "ok" });
    if (url !== "/mcp") return send(res, 404, { error: "not found" });

    const ip = req.socket.remoteAddress ?? "?";
    if (limited(ip)) return send(res, 429, { error: "too many failed attempts" });

    const auth = req.headers["authorization"];
    const bearer = typeof auth === "string" && /^Bearer /i.test(auth) ? auth.slice(7).trim() : "";
    const xkey = typeof req.headers["x-api-key"] === "string" ? (req.headers["x-api-key"] as string).trim() : "";
    const given = bearer || xkey;
    if (!given || !keyValid(given, keys)) {
      recordFail(ip);
      res.setHeader("www-authenticate", "Bearer");
      return send(res, 401, { error: "unauthorized" });
    }

    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      return send(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)." }, id: null });
    }

    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port, opts.host, () => resolve());
  });
  console.error(`yettel MCP (read-only) listening on http://${opts.host}:${opts.port}/mcp  (${keys.length} key(s) configured)`);
}
