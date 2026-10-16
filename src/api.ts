/**
 * HTTP client for the Yettel Bank back-end (https://mobile.yettelbank.rs).
 * Uses Node's global fetch (Node >= 20). Mirrors the web app's header rules
 * documented in docs/login-api.md.
 */
import {
  ENDPOINTS,
  HEADERS,
  PREFERRED_CLIENT_CULTURE,
  preloginBearer,
} from "./config.js";
import type { Session } from "./storage.js";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  url: string,
  init: RequestInit & { mcApiBearer: string; bcApiToken?: string },
): Promise<T> {
  const { mcApiBearer, bcApiToken, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  headers.set(HEADERS.mcApi, `Bearer ${mcApiBearer}`);
  if (bcApiToken) headers.set(HEADERS.bcApi, `Bearer ${bcApiToken}`);

  const res = await fetch(url, { ...rest, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(
      `${rest.method ?? "GET"} ${url} → HTTP ${res.status}`,
      res.status,
      text,
    );
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Step 1 of QR login. Returns the operationId (also the QR payload). */
export async function initiateQrLogin(): Promise<string> {
  const data = await request<{ operationId: string }>(ENDPOINTS.initiateQrLogin, {
    method: "POST",
    body: "{}",
    mcApiBearer: preloginBearer(),
  });
  if (!data?.operationId) throw new Error("initiateQrLogin: missing operationId in response");
  return data.operationId;
}

/** Step 4 of QR login. Fetches the McApi client token (uses pre-login key). */
export async function fetchClientToken(): Promise<string> {
  const data = await request<{ "token-value": string }>(ENDPOINTS.clientToken, {
    method: "POST",
    body: "{}",
    mcApiBearer: preloginBearer(),
  });
  const token = data?.["token-value"];
  if (!token) throw new Error("clientToken: missing token-value in response");
  return token;
}

/** Refresh an expired access token. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const data = await request<{ access_token: string }>(ENDPOINTS.refreshToken, {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
    mcApiBearer: preloginBearer(),
  });
  if (!data?.access_token) throw new Error("refresh: missing access_token in response");
  return data.access_token;
}

function mcBearer(session: Session): string {
  return session.clientToken || preloginBearer();
}

function requireAuth(session: Session): asserts session is Session & {
  accessToken: string;
  partyId: string;
} {
  if (!session.accessToken) throw new Error("Not logged in. Run `yettel login` first.");
  if (!session.partyId) throw new Error("Session missing partyId. Re-run `yettel login`.");
}

/**
 * -------- Phase 2 placeholders --------
 * The paths/field names below were read from the public bundle but the exact
 * response envelopes must be confirmed from a HAR (see README) before trusting
 * the shapes. They are wired to the right endpoints so that, once the HAR
 * confirms the JSON, only the response mapping needs finishing.
 */

export interface RawAccount {
  accountNumber?: string;
  accountName?: string;
  accountType?: string;
  availableBalance?: number | string;
  currentBalance?: number | string;
  currency?: string;
  iban?: string;
  [key: string]: unknown;
}

/** GET /private/v1/accounts-overview/{partyId} */
export async function getAccountsOverview(session: Session): Promise<unknown> {
  requireAuth(session);
  return request<unknown>(ENDPOINTS.accountsOverview(session.partyId), {
    method: "GET",
    headers: { "Cache-Control": "no-cache" },
    mcApiBearer: mcBearer(session),
    bcApiToken: session.accessToken,
  });
}

export interface TransactionsQuery {
  currency?: string;
  page?: number; // 0-based, as the web app uses
  dateFrom?: string; // ISO
  dateTo?: string; // ISO
  search?: string; // counterPartyIdent
}

/** GET /private/v2/transactions-overview/{accountNumber}?... */
export async function getTransactions(
  session: Session,
  accountNumber: string,
  q: TransactionsQuery = {},
): Promise<unknown> {
  requireAuth(session);
  const params = new URLSearchParams();
  if (q.currency) params.set("currencies", q.currency);
  params.set("page", String(q.page ?? 0));
  params.set("page-size", "10");
  if (q.dateFrom) params.set("date-from", q.dateFrom);
  if (q.dateTo) params.set("date-to", q.dateTo);
  if (q.search) params.set("counterPartyIdent", q.search);
  params.set("preferred-client-culture", PREFERRED_CLIENT_CULTURE);
  return request<unknown>(
    ENDPOINTS.transactionsOverview(accountNumber, params.toString()),
    {
      method: "GET",
      headers: { "Cache-Control": "no-cache" },
      mcApiBearer: mcBearer(session),
      bcApiToken: session.accessToken,
    },
  );
}
