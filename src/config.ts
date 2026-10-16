/**
 * Static configuration reverse-engineered from the PUBLIC Yettel Bank web bundle
 * served at https://online.yettelbank.rs/. See docs/login-api.md for provenance.
 *
 * None of these are user secrets. The pre-login bearer below is a PUBLIC client
 * key shipped verbatim to every browser so that anonymous pre-login calls (QR
 * login, sign-up) are accepted. It can rotate between front-end deploys; if the
 * pre-login endpoints start returning 401, re-extract it from the bundle (see
 * README) and override via the YETTEL_PRELOGIN_BEARER env var.
 */

export const API_ORIGIN = "https://mobile.yettelbank.rs";
export const WS_ORIGIN = "wss://mobile.yettelbank.rs";

export const ENDPOINTS = {
  initiateQrLogin: `${API_ORIGIN}/security/v1/auth/initiateQrLogin`,
  callbackQrLogin: `${WS_ORIGIN}/security/v1/auth/callbackQrLogin`,
  clientToken: `${API_ORIGIN}/public/v1/mcapi/authentication/token`,
  refreshToken: `${API_ORIGIN}/public/v1/auth/token`,
  accountsOverview: (partyId: string) =>
    `${API_ORIGIN}/private/v1/accounts-overview/${partyId}`,
  cardsOverview: (accountNumber: string) =>
    `${API_ORIGIN}/private/v3/cards-overview?accountNumber=${encodeURIComponent(accountNumber)}`,
  party: (partyId: string) => `${API_ORIGIN}/private/v2/parties/${partyId}`,
  transactionsOverview: (accountNumber: string, qs: string) =>
    `${API_ORIGIN}/private/v2/transactions-overview/${accountNumber}?${qs}`,
} as const;

/** Authorization header names used by the web client. */
export const HEADERS = {
  bcApi: "Authorization",
  mcApi: "McApiAuthorization",
} as const;

/**
 * Public pre-login client key extracted from the public JS bundle
 * (`/assets/index-*.js`). Overridable via env for when it rotates.
 */
const DEFAULT_PRELOGIN_BEARER =
  "rZX09hkz6JpSdxan4vK-Z1RSlO-GDg2CzPAC8x2PkUyJdKkAG7ZM23N4jNJZGNaqFkTMatgh6c2sxvZPflIBxtpdjroJ5rb_1RFk127FKGkXzfijcjlsia9aKp7AkLmr-XkvoyEWYltsB0Dm1WPM79yIWyANUcH3uGTCfItM2lZmqlTuolLZu5avKpAvFLCA9Dr7Y72d7yKmzyjjb-IXPYDjBP15qKQCz_2Qzw54deOnY7GjTO0-KePiTcjKadG48sx_BFBfiT5c-vZuTHtEquB8qYbXa3MG2Eo7KNGE62jRsk895R0jJCtbdBtwtpl7xpIecCXVvf9VNgsyuIyd3bi6-Hb5NWV1PjaP--GbvRp4yITwVXU5ASIGpkTNRYTdXEQKkSqn7t4_wAcCYCjSqMBk9j-ltEvJjzhMiS0XA4FIAHoEOw6UGnadFfGQ2o8vY2chQfOvsCpqJ9HRvKUBWz9Dp5e2J0j9niUaEU4b8Q2kQhSQ";

export function preloginBearer(): string {
  return process.env.YETTEL_PRELOGIN_BEARER?.trim() || DEFAULT_PRELOGIN_BEARER;
}

/** QR lifecycle, matching the web UI (25s per QR). */
export const QR_TTL_SECONDS = 25;

/** Default UI culture sent as `preferred-client-culture` on McApi GETs. */
export const PREFERRED_CLIENT_CULTURE = "sr-RS";
