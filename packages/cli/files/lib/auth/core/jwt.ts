import type { TokenPayload } from "../types";
import { TokenPayloadSchema } from "../types";

/**
 * Decodes a JWT without verifying the signature.
 * Verification is the responsibility of your API — we only need the payload
 * for expiry checks and user data hydration.
 *
 * Returns null if the token is malformed or cannot be parsed.
 */
export function decodeJwt(token: string): TokenPayload | null {
  try {
    const segments = token.split(".");
    if (segments.length !== 3) return null;

    const payloadSegment = segments[1];
    // Convert base64url to standard base64 and pad to a valid length
    const base64 = payloadSegment
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(
        payloadSegment.length + ((4 - (payloadSegment.length % 4)) % 4),
        "=",
      );

    const jsonString = Buffer.from(base64, "base64").toString("utf-8");
    const payload = JSON.parse(jsonString) as unknown;

    if (typeof payload !== "object" || payload === null) return null;
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

export interface TokenExpiryInfo {
  /** Seconds remaining until the token expires (may be negative if expired). */
  maxAgeSeconds: number;
  /** The absolute expiry date. */
  expiresAt: Date;
  /** True if the token has already expired. */
  isExpired: boolean;
}

/**
 * Returns expiry information for a JWT.
 * Returns null if the token cannot be decoded or lacks an `exp` claim.
 */
export function getTokenExpiry(token: string): TokenExpiryInfo | null {
  const payload = decodeJwt(token);
  if (!payload) return null;

  const validated = TokenPayloadSchema.safeParse(payload);
  if (!validated.success) return null;

  const { exp } = validated.data;
  const expiresAt = new Date(exp * 1000);
  const nowMs = Date.now();
  const maxAgeSeconds = Math.floor((expiresAt.getTime() - nowMs) / 1000);

  return {
    maxAgeSeconds,
    expiresAt,
    isExpired: maxAgeSeconds <= 0,
  };
}

/**
 * Returns true if the token is a valid, non-expired JWT.
 */
export function isTokenValid(token: string): boolean {
  const expiry = getTokenExpiry(token);
  return expiry !== null && !expiry.isExpired;
}

/**
 * Returns the number of seconds until the token expires.
 * Returns 0 if the token is invalid or already expired.
 */
export function getSecondsUntilExpiry(token: string): number {
  const expiry = getTokenExpiry(token);
  if (!expiry) return 0;
  return Math.max(0, expiry.maxAgeSeconds);
}
