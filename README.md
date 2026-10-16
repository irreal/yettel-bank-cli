# yettel-cli

> **Disclaimer:** Unofficial, personal-use tooling. **Not affiliated with,
> endorsed by, or supported by Yettel Bank.** Use on your own account, at your
> own risk. Licensed under [MIT](LICENSE).

A **personal, owner-authorized** command-line tool for the account owner of
[Yettel Bank (Serbia)](https://online.yettelbank.rs/) online banking.

It reproduces the bank's **QR login** flow from the command line: it asks the
public back-end for a QR challenge, prints the QR so you can scan it with the
**Yettel mobile banking app**, waits for the app to approve, and stores the
resulting session tokens in a local file. Listing accounts, balances and
transactions are **implemented** wired to the right endpoints — see
[Phase 2](#phase-2-finishing-accounts--transactions).

> This is tooling for your **own** account. It does **not** bypass MFA, scrape
> credentials, or move money. Login is approved on your phone, by you, every time.

## How it works

The web app at `online.yettelbank.rs` is a React SPA that talks to the bank's
mobile back-end at `https://mobile.yettelbank.rs`. Login is QR + WebSocket push:

1. `POST /security/v1/auth/initiateQrLogin` → `{ operationId }`
2. The `operationId` is encoded into a QR code you scan with the mobile app.
3. A WebSocket (`wss://.../security/v1/auth/callbackQrLogin`) is opened and
   subscribed to that `operationId`; the server pushes `operationStatus` updates
   and finally `{ accessToken, refreshToken }` once you approve on the phone.
4. The CLI decodes the JWT, fetches a McApi client token, and saves everything.

The full reverse-engineering (every endpoint, header, field name, and the token
model) is documented in [`docs/login-api.md`](docs/login-api.md). It was derived
**only** from the public JavaScript bundles — no credentials or private session
were used.

## Requirements

- Node.js >= 20 (uses the built-in global `fetch`)
- The Yettel mobile banking app on your phone, logged in to your account

## Install

```bash
npm install
npm run build      # compiles TypeScript to dist/
```

## Usage

Run directly with the compiled build:

```bash
node dist/cli.js <command>
```

…or without building, in dev mode:

```bash
npm run dev -- <command>      # e.g. npm run dev -- login
```

### Commands

| Command | What it does |
| --- | --- |
| `login` | Start the QR login flow and save the session. `--show-payload` also prints the raw operationId; `--max-attempts <n>` controls QR regenerations. |
| `status` | Show whether a session is stored and for which party/customer id. |
| `logout` | Delete the stored session file. |
| `accounts` | **[phase 2]** List accounts (raw JSON for now; `--json`). |
| `balances` | **[phase 2]** Show balances (from the accounts payload). |
| `transactions <accountNumber>` | **[phase 2]** List recent transactions. Options: `--currency`, `--page`, `--from`, `--to`, `--search`, `--json`. |

### Logging in

```bash
node dist/cli.js login
```

A QR code prints in your terminal. Open the **Yettel mobile banking app**, use its
QR / login-approval feature, and scan it. The CLI shows `operationStatus` updates
and, once you approve, saves the session:

```
✓ Logged in. Session saved to ~/.config/yettel-cli/session.json (mode 0600).
```

Each QR expires in ~25s; the CLI automatically regenerates a new one up to
`--max-attempts` times.

## Where the session is stored

By default: `~/.config/yettel-cli/session.json` (honoring `XDG_CONFIG_HOME`),
created with `0600` permissions. Override the directory with `YETTEL_CLI_HOME`.

The file contains the live **access token**, **refresh token**, **client token**,
and your `partyId` / `customerId`.

## Security notes — read this

- **Personal use only.** This is for your own account, approved from your own phone.
- **Never commit tokens.** `session.json`, `.env`, and `*.har` are git-ignored.
  Do not paste token values into issues, chats, or commits.
- The session file grants access to your bank data. Treat it like a password:
  keep it on an encrypted disk, don't sync it to shared storage, and run
  `node dist/cli.js logout` to delete it when done.
- The pre-login `McApiAuthorization` bearer baked into `src/config.ts` is a
  **public** client key shipped to every browser in the bank's own JS — it is not
  your secret. If the bank rotates it and pre-login calls start returning 401,
  re-extract it from the bundle (see below) or set `YETTEL_PRELOGIN_BEARER`.
- Nothing here automates payments or transfers.

### Re-extracting the public pre-login key (if it rotates)

```bash
curl -s https://online.yettelbank.rs/ | grep -o '/assets/index-[^"]*\.js'
curl -s https://online.yettelbank.rs/assets/index-<hash>.js \
  | grep -o 'includes(e)))?"Bearer [^"]*"'
```

## Usage (read-only)

```bash
yettel login                 # shows a QR; scan it in the Yettel mobile app
yettel accounts              # list accounts with balances
yettel balances              # balances only
yettel account <number>      # account details (IBAN, status, balance)
yettel transactions <number> --currency RSD --page 0 --page-size 20
yettel transactions <number> --amount-from 500 --amount-to 600
yettel status | logout
```

Add `--json` to any data command for raw output. The access token lives only a
few minutes; the CLI refreshes it automatically with the stored refresh token and
asks you to log in again if that fails.


## MCP server (read-only) — `yettel mcp`

Exposes three **read-only** tools to MCP clients such as ChatGPT: `list_accounts`,
`get_account_detail`, `get_transactions`. There are no transfer or write tools.
It reuses the stored session (`YETTEL_CLI_HOME` respected) and refreshes tokens
automatically; if the session is missing or expired the tools tell you to run
`yettel login`.

```bash
yettel mcp                                  # stdio (Claude Desktop, Cursor, ...)

export YETTEL_MCP_API_KEYS=$(openssl rand -hex 32)   # comma-separated for several keys
yettel mcp --http --port 8787               # http://127.0.0.1:8787/mcp
```

HTTP mode is stateless streamable HTTP at `/mcp`. It refuses to start without an
API key (`YETTEL_MCP_API_KEYS`, or the alias `YETTEL_MCP_TOKEN`). Send the key as
`Authorization: Bearer <key>` or `X-API-Key: <key>`. Keys are compared in
constant time, repeated failed auth from one IP gets HTTP 429, and `/healthz`
(no auth) returns only `{"status":"ok"}`. Keys and bank data are never logged.
`--host` defaults to `127.0.0.1`; `PORT` is honored when `--port` is omitted.

### Connect to ChatGPT

In ChatGPT: Plugins > Add custom MCP server, then choose authentication
"API key / Bearer" and paste your key. Server URL options:

- a public HTTPS URL ending in `/mcp` (see public hosting below), or
- the OpenAI Secure MCP Tunnel: run `tunnel-client` on your machine pointing at
  `http://127.0.0.1:8787/mcp`, so nothing is exposed publicly (safest).

### Public hosting

> **Warning:** a public endpoint holds live access to your bank account. Use a
> long random key (at least 32 chars is enforced for non-localhost hosts), keep
> it secret, and prefer the tunnel if you can. Revoke the session in the Yettel
> app if the host or key may be compromised.

- Binding to a non-localhost address needs `--host 0.0.0.0` and a key of 32+ chars.
- The server speaks plain HTTP. **TLS must be terminated by a reverse proxy or the
  host** (Fly.io, Caddy, nginx, ...).
- The QR login happens locally: run `yettel login` on your own computer, then copy
  the session file (`yettel status` shows its path) to the host's persistent
  volume as `$YETTEL_CLI_HOME/session.json` (`/data/session.json` in Docker).
  Refreshed tokens are written back to that file, so the volume must be writable
  and persisted. If the refresh token ever expires, log in locally and copy again.

Docker:

```bash
docker build -t yettel-mcp .
docker run -p 8787:8787 -v yettel-data:/data -e YETTEL_MCP_API_KEYS=<key> yettel-mcp
```

On Fly.io: create an app and a volume mounted at `/data`, set the key with
`fly secrets set YETTEL_MCP_API_KEYS=...`, set the internal port to 8787, and
upload `session.json` into the volume (e.g. `fly ssh sftp shell`).

## Project layout

```
src/
  cli.ts                 # commander entrypoint
  config.ts              # endpoints, header names, public pre-login key
  storage.ts             # local session file (0600) in ~/.config/yettel-cli
  api.ts                 # HTTP client + initiate/clientToken/refresh + phase-2 reads
  ws.ts                  # QR login WebSocket waiter
  jwt.ts                 # JWT claim decoder (no signature verification)
  login.ts               # QR login orchestration
  commands/
    accounts.ts          # phase-2 placeholder
    transactions.ts      # phase-2 placeholder
docs/
  login-api.md           # full reverse-engineered login API map
```

## License & disclaimer

Released under the [MIT License](LICENSE). This is unofficial software: not
affiliated with or endorsed by Yettel Bank. Use on your own account, at your own
risk, in accordance with your bank's terms of service.
