/**
 * Orchestrates the full QR login flow: create challenge → render QR → wait on
 * WebSocket → decode JWT → fetch client token → persist session.
 */
import qrcode from "qrcode-terminal";
import { initiateQrLogin, fetchClientToken } from "./api.js";
import { waitForQrLogin } from "./ws.js";
import { decodeJwt } from "./jwt.js";
import { QR_TTL_SECONDS } from "./config.js";
import { saveSession, sessionPath, type Session } from "./storage.js";

export interface LoginOptions {
  /** How many QR codes to generate before giving up. */
  maxAttempts?: number;
  /** Print the raw operationId payload alongside the QR. */
  showPayload?: boolean;
}

export async function runLogin(opts: LoginOptions = {}): Promise<Session> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const graceMs = 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    process.stdout.write(
      `\nRequesting QR challenge (attempt ${attempt}/${maxAttempts})...\n`,
    );
    const operationId = await initiateQrLogin();

    console.log(
      "\nScan this QR with the Yettel mobile banking app to approve login:\n",
    );
    qrcode.generate(operationId, { small: true });
    if (opts.showPayload) {
      console.log(`QR payload (operationId): ${operationId}`);
    }
    console.log(
      `This QR expires in ~${QR_TTL_SECONDS}s. Waiting for approval...` +
        " (press Ctrl+C to cancel)\n",
    );

    const { promise } = waitForQrLogin(operationId, {
      timeoutMs: (QR_TTL_SECONDS + 5) * 1000 + graceMs,
      onStatus: (msg) => {
        process.stdout.write(`  … server: ${JSON.stringify(msg)}\n`);
      },
    });

    try {
      const result = await promise;
      return await finishLogin(result.accessToken, result.refreshToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= maxAttempts) {
        throw new Error(`Login failed after ${maxAttempts} attempts: ${msg}`);
      }
      console.log(`  QR expired or connection dropped (${msg}). Regenerating...`);
    }
  }
  throw new Error("Login failed: no attempts succeeded.");
}

async function finishLogin(
  accessToken: string,
  refreshToken: string,
): Promise<Session> {
  const claims = decodeJwt(accessToken);
  const session: Session = {
    accessToken,
    refreshToken,
    partyId: claims.customerId?.trim(),
    customerId: claims.experienceId,
    loginTime: Date.now(),
  };

  // Fetch the McApi client token (best effort — not required to be logged in).
  try {
    session.clientToken = await fetchClientToken();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  Warning: could not fetch McApi client token: ${msg}`);
  }

  saveSession(session);
  console.log(`\n✓ Logged in. Session saved to ${sessionPath()} (mode 0600).`);
  console.log("  Keep this file private — it contains live access tokens.");
  return session;
}
