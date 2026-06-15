import { createHmac, timingSafeEqual } from "node:crypto";
import type { IngestEnvelope } from "./types.js";

export const SIGNATURE_HEADER = "x-job-signature";
const PREFIX = "sha256=";

export function signBody(body: string | Buffer, secret: string): string {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return `${PREFIX}${digest}`;
}

export function verifySignature(body: string | Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature?.startsWith(PREFIX)) return false;
  const expected = signBody(body, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function postSigned(callbackUrl: string, secret: string, envelope: IngestEnvelope): Promise<void> {
  const body = JSON.stringify(envelope);
  const res = await fetch(callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: signBody(body, secret),
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`callback failed ${res.status}: ${text}`);
  }
}
