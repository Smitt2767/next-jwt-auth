import type { TokenPayload } from "../types";
import { TokenPayloadSchema } from "../types";

/**
 * Decodes a JWT without verifying the signature.
 * Verification is the responsibility of your API — we only need the payload
 * for expiry checks and user data hydration.
 *
 * @param token - The raw JWT string to decode.
 * @returns The decoded payload object, or `null` if the token is malformed or cannot be parsed.
 */
export function decodeJwt(token: string): TokenPayload | null {
  try {
    const segments = token.split(".");
    if (segments.length !== 3) return null;

    const payloadSegment = segments[1];
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

/** Expiry metadata derived from a JWT's `exp` claim. */
export interface TokenExpiryInfo {
  /** Seconds remaining until expiry. Negative if already expired. */
  maxAgeSeconds: number;
  /** Absolute expiry time as a Date. */
  expiresAt: Date;
  /** True if the token's expiry time is in the past. */
  isExpired: boolean;
}

/**
 * Extracts expiry information from a JWT's `exp` claim.
 *
 * @param token - The raw JWT string to inspect.
 * @returns Expiry info object, or `null` if the token cannot be parsed or has no valid `exp`.
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

  return { maxAgeSeconds, expiresAt, isExpired: maxAgeSeconds <= 0 };
}

/**
 * Returns `true` if the token is well-formed and its `exp` claim is in the future.
 *
 * @param token - The raw JWT string to validate.
 * @returns `true` if the token is valid and not expired; `false` otherwise.
 */
export function isTokenValid(token: string): boolean {
  const expiry = getTokenExpiry(token);
  return expiry !== null && !expiry.isExpired;
}

/**
 * Returns the number of seconds until the token expires.
 * Returns `0` if the token is already expired or cannot be decoded.
 *
 * @param token - The raw JWT string to inspect.
 * @returns Remaining seconds until expiry, clamped to a minimum of `0`.
 */
export function getSecondsUntilExpiry(token: string): number {
  const expiry = getTokenExpiry(token);
  if (!expiry) return 0;
  return Math.max(0, expiry.maxAgeSeconds);
}
