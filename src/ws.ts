/**
 * QR login WebSocket waiter. Connects to callbackQrLogin, subscribes with the
 * operationId, and resolves when the server pushes the access/refresh tokens.
 * Mirrors the web app's WebSocket manager (see docs/login-api.md §2).
 */
import WebSocket from "ws";
import { ENDPOINTS } from "./config.js";

export interface QrLoginResult {
  accessToken: string;
  refreshToken: string;
  raw: Record<string, unknown>;
}

export function waitForQrLogin(
  operationId: string,
  opts: { timeoutMs?: number; onStatus?: (msg: unknown) => void } = {},
): { promise: Promise<QrLoginResult>; close: () => void } {
  const ws = new WebSocket(ENDPOINTS.callbackQrLogin);
  let settled = false;
  let timer: NodeJS.Timeout | undefined;

  const close = () => {
    if (timer) clearTimeout(timer);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  const promise = new Promise<QrLoginResult>((resolve, reject) => {
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      close();
      reject(err);
    };
    const succeed = (result: QrLoginResult) => {
      if (settled) return;
      settled = true;
      close();
      resolve(result);
    };

    if (opts.timeoutMs) {
      timer = setTimeout(() => fail(new Error("QR login timed out")), opts.timeoutMs);
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({ command: "SUBSCRIBE", operationId }));
    });

    ws.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // ignore non-JSON frames
      }
      if (typeof msg.accessToken === "string" && msg.accessToken) {
        succeed({
          accessToken: msg.accessToken as string,
          refreshToken: (msg.refreshToken as string) ?? "",
          raw: msg,
        });
      } else {
        // intermediate status frame (e.g. scanned/pending) — surface it
        opts.onStatus?.(msg);
      }
    });

    ws.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    ws.on("close", () => fail(new Error("WebSocket closed before login completed")));
  });

  return { promise, close };
}
