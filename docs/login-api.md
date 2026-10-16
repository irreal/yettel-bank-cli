# Yettel Bank (Serbia) e-banking — Login API map

> **Source:** Reverse-engineered **only** from the public, unauthenticated front-end
> bundles served by `https://online.yettelbank.rs/` (a Vite/React SPA). No
> authenticated session, credentials, or MFA bypass was involved. All secrets
> below are **masked**. Nothing here is invented — every path, field name and
> header was read from the shipped JavaScript.
>
> Bundles inspected (hashes will change on each deploy):
> - `/assets/index-<hash>.js` (main bundle: API client, interceptors, constants)
> - `/assets/Login.page-<hash>.js` (QR login screen + WebSocket handling)
> - `/assets/TransactionsList.api-<hash>.js` + `TransactionsList.mapper-<hash>.js`
>
> The SPA talks to a **different origin** than the one it is served from:
> the API host is **`https://mobile.yettelbank.rs`** (the same back-end the mobile
> app uses), not `online.yettelbank.rs`.

---

## 1. Hosts, header names and token storage

| Concept | Value (from bundle) |
| --- | --- |
| Web app origin | `https://online.yettelbank.rs` |
| API origin ("BcApi" / back-end-for-front-end) | `https://mobile.yettelbank.rs/` |
| "McApi" base | `https://mobile.yettelbank.rs/public/v1/mcapi/` |
| WebSocket origin | `wss://mobile.yettelbank.rs` |

There are **two** authorization headers the client sends:

| Header name | Carries | When sent |
| --- | --- | --- |
| `Authorization` | `Bearer <b4fToken>` (the logged-in access token) | on every request **once logged in** |
| `McApiAuthorization` | `Bearer <clientToken>` **or** a static public pre-login key | on every request; see below |

`McApiAuthorization` value is chosen by this rule (from `index` bundle):

- If the current URL is one of `/login`, `/on-boarding`, `/prelogin`,
  `/ValidateEmail` → send a **hard-coded public pre-login bearer** (a static
  client key shipped to every browser, ~496 chars, masked here):

  ```
  McApiAuthorization: Bearer rZX09hkz6JpSdxan4vK-Z1RSlO-GDg2Cz…EU4b8Q2kQhSQ
  ```

  This is **not** a user secret — it is a public API key embedded verbatim in the
  public JS so that anonymous/pre-login calls (QR login, sign-up) are accepted. It
  may rotate between deploys; re-extract it from the bundle if the API starts
  returning 401 on the pre-login calls.
- Otherwise → `Bearer <clientToken>` where `clientToken` is obtained **after**
  login (see §5).

Tokens are kept by the web app in **`localStorage`** under these keys
(constant object `i6` in the bundle):

| Logical name | localStorage key | Meaning |
| --- | --- | --- |
| `MCAPI_TOKEN` | `clientToken` | McApi bearer fetched post-login |
| `BCAPI_TOKEN` | `b4fToken` | Access token (JWT) — the real login token |
| `BCAPI_REFRESH_TOKEN` | `b4fRefreshToken` | Refresh token |
| `CUSTOMER_ID` | `customerId` | `experienceId` claim from the access-token JWT |
| `PARTY_ID` | `partyId` | `customerId` claim from the access-token JWT |

> The CLI in this repo stores the equivalent values in a local file instead of a
> browser's `localStorage` — see the README security notes.

### Request interceptor behaviour (axios)

- Collapses duplicate `//` in the path.
- Always sets `McApiAuthorization` (per the rule above).
- If `b4fToken` is present: adds `Accept: application/json` and
  `Authorization: Bearer <b4fToken>`.
- For McApi `GET`s: appends `preferred-client-culture` as **both** a query param
  and a header (`sr-RS` / `en-IN` / `en-US` depending on UI language).
- For BcApi requests: adds `Accept-Language`.

### Response interceptor (token refresh)

On `HTTP 401` the client retries (up to 2×) after refreshing:

```
POST https://mobile.yettelbank.rs/public/v1/auth/token
Content-Type: application/json

{ "refresh_token": "<b4fRefreshToken>" }
→ 200 { "access_token": "<new b4fToken>", ... }
```

If refresh fails it clears all tokens and redirects to home (logout).

---

## 2. QR login — the complete flow

The login is a **QR + WebSocket push** flow (there is **no HTTP polling** and no
password entry in the web app). Steps:

### Step 1 — create the QR challenge

```
POST https://mobile.yettelbank.rs/security/v1/auth/initiateQrLogin
McApiAuthorization: Bearer <public pre-login key>   (see §1)
Content-Type: application/json

{}                       ← empty JSON body
→ 200 { "operationId": "<opaque-string>" }
```

The returned **`operationId` is exactly what gets encoded into the QR image**
that the browser renders (`<QRCode value={operationId} />`, 230px). The user
scans it with the **Yettel mobile banking app**, which approves the login on the
server side.

### Step 2 — subscribe for the result over WebSocket

```
WS  wss://mobile.yettelbank.rs/security/v1/auth/callbackQrLogin
```

Immediately on `open`, the client sends a subscribe frame:

```json
{ "command": "SUBSCRIBE", "operationId": "<operationId from step 1>" }
```

Then it waits for messages. Each incoming message is `JSON.parse`d and handed to a
callback. The **login-success message** contains the tokens:

```json
{
  "accessToken":  "<JWT b4fToken>",
  "refreshToken": "<b4fRefreshToken>",
  ...
}
```

The web app only acts once a message has a truthy `accessToken`; any
intermediate/status frames before that are ignored. (The same WebSocket manager
is reused for transaction signing via `…/security/v1/auth/callbackOperation`.)

**Confirmed from a live, unauthenticated subscribe** (no scan): immediately after
the `SUBSCRIBE` frame the server pushes status frames shaped like:

```json
{ "operationId": "<operationId>", "operationStatus": "PENDING" }
```

`operationStatus` advances as the user scans/approves in the app; the final frame
(after approval) is the token message above. This CLI surfaces these status
frames via the `onStatus` callback.

### Step 3 — on success, persist and decode

From the success message the web app:

- decodes `accessToken` as a **JWT** and reads two claims:
  - `customerId` → stored as `partyId`
  - `experienceId` → stored as `customerId`
- stores `accessToken` → `b4fToken`, `refreshToken` → `b4fRefreshToken`,
  and a `loginTime` timestamp.

### Step 4 — fetch the McApi client token

After the tokens are stored, the app fetches a client token so McApi calls work:

```
POST https://mobile.yettelbank.rs/public/v1/mcapi/authentication/token
McApiAuthorization: Bearer <public pre-login key>
Content-Type: application/json

{}
→ 200 { "token-value": "<clientToken>" }
```

`token-value` is stored as `clientToken` and from then on becomes the
`McApiAuthorization` bearer for authenticated McApi requests.

### QR lifecycle / expiry (UI only)

- A countdown starts at **25 seconds** per QR.
- When it hits 0 the app auto-regenerates the QR (new `initiateQrLogin` +
  new WebSocket subscribe). After **2** regenerations it stops and shows a
  "generate new QR" button that the user must click.
- i18n keys confirm this: `content.login.qr_expires_in`,
  `content.login.generate_new_qr`, `content.login.new_qr_button`.

### Sequence diagram

```
CLI/Browser                         mobile.yettelbank.rs            Mobile app
    |  POST security/v1/auth/initiateQrLogin {}  |                      |
    | ------------------------------------------>|                      |
    |            { operationId }                 |                      |
    |<------------------------------------------ |                      |
    |  render QR(operationId)                     |                      |
    |                                             |   scan QR + approve  |
    |  WS connect callbackQrLogin                 |<---------------------|
    | ------------------------------------------>|                      |
    |  {command:SUBSCRIBE, operationId}           |                      |
    | ------------------------------------------>|                      |
    |     { accessToken, refreshToken }  (push)   |                      |
    |<------------------------------------------ |                      |
    |  POST public/v1/mcapi/authentication/token  |                      |
    | ------------------------------------------>|                      |
    |            { token-value }                  |                      |
    |<------------------------------------------ |                      |
```

---

## 3. Auth-related REST surface (summary)

| Method | Path (host `https://mobile.yettelbank.rs`) | Body | Returns | Auth |
| --- | --- | --- | --- | --- |
| POST | `/security/v1/auth/initiateQrLogin` | `{}` | `{ operationId }` | pre-login key |
| WS | `/security/v1/auth/callbackQrLogin` | `{command:"SUBSCRIBE",operationId}` | `{ accessToken, refreshToken, … }` | — (op-scoped) |
| POST | `/public/v1/mcapi/authentication/token` | `{}` | `{ "token-value" }` | pre-login key |
| POST | `/public/v1/auth/token` | `{ refresh_token }` | `{ access_token, … }` | — |
| WS | `/security/v1/auth/callbackOperation` | `{command:"SUBSCRIBE",operationId}` | operation-signing push (transfers) | — (op-scoped) |

Other pre-login McApi auth endpoints present in the bundle (sign-up / validation,
**not needed for QR login**, listed for completeness):
`/public/v1/mcapi/authentication/users`,
`…/users/email/validation-tokens(/verify)`,
`…/users/phone/validation-tokens`,
`…/users/msisdn/validation-tokens/verify`.

---

## 4. Post-login (phase 2) endpoints found in the bundle

These are the authenticated data endpoints referenced by the public JS. They
require `Authorization: Bearer <b4fToken>` (and, for McApi ones, a valid
`McApiAuthorization: Bearer <clientToken>`). Exact query params / response bodies
should be **confirmed from a HAR** (see README) before relying on them.

| Purpose | Method | Path | Notes |
| --- | --- | --- | --- |
| Accounts overview | GET | `/private/v1/accounts-overview/{partyId}` | header `Cache-Control: no-cache`; `{partyId}` from JWT |
| Account detail | GET | `/private/v2/accounts-overview/account-detail/{…}` | |
| Cards overview | GET | `/private/v3/cards-overview?accountNumber={acct}` | returns `{ cards: [...] }` |
| Party / profile | GET | `/private/v2/parties/{partyId}` | |
| Loan detail | GET | `/private/v1/loans/{id}/detail` | |
| **Transactions list** | GET | `/private/v2/transactions-overview/{accountNumber}?currencies={cur}&page={n}&page-size=10[&filters]` | `page` is **0-based**; credit cards omit `currencies` |
| Transaction detail | GET | `/public/v1/mcapi/customer-account/accounts/{accountNumber}/transactions/{transactionId}` | McApi |
| Inbox messages | GET | `/private/v2/user-inbox/{partyId}/messages` | |
| Documents | GET | `/private/v1/documents/{id}` | `accept: application/pdf`, blob |

### Known field names (from the front-end mappers)

**Accounts** (`accounts-overview`): `accountNumber`, `accountName`,
`accountType`, `availableBalance`, `currentBalance`, `currency`, `iban`.

**Transaction** (raw item in `transactions-overview` → `transactions[]`):
`transactionId`, `bookDate`, `transactionTime`, `amount`, `currency`,
`direction` (debit/credit), `status`, `source`, `transactionKind`,
`transactionCodeDescription`, `cardNumber`, `cardTransactionId`, and
`counterParty: { name, accountNumber }`.

**Transactions-list query filters** (optional, mapped to query string):
`directions`, `statuses`/`status`, `origins`, `paymentTypes`, `amountFrom`,
`amountTo`, `date-from`/`dateFrom` (ISO), `date-to`/`dateTo` (ISO),
`counterPartyIdent` (free-text search).

---

## 5. What is still unknown (needs a HAR from phase 2)

- Exact **response envelope** of `accounts-overview` (array vs `{ accounts: [] }`,
  balance object shape, nested currency breakdown).
- Whether `transactions-overview` returns paging metadata
  (`totalPages`, `hasNext`, …) alongside `transactions[]`.
- The full set of `operationStatus` values (only `PENDING` was observed without a
  scan; the approved/scanned values and the token frame need a real login HAR).
- Whether `clientToken` is strictly required for `/private/*` BcApi reads or only
  for `/public/v1/mcapi/*` reads.

Capture these by exporting a HAR after a real login (instructions in the README).
