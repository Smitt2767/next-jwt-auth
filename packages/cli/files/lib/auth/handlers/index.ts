// lib/auth/handlers/index.ts
//
// OAuth handler stub — present before OAuth is configured.
// Run `npx @smittdev/next-jwt-auth add oauth` to replace this with the real handler.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Creates the GET handler for the OAuth catch-all route.
 *
 * This is a stub that throws a descriptive error — OAuth is not yet configured.
 * Run `npx @smittdev/next-jwt-auth add oauth` to replace this file with the
 * real implementation that handles provider login and callback flows.
 *
 * @returns A Next.js `GET` route handler function.
 */
export function createOAuthHandler() {
  return async function GET(
    _request: NextRequest,
    _ctx: unknown,
  ): Promise<NextResponse> {
    throw new Error(
      "[next-jwt-auth] OAuth is not configured.\n" +
        "Run `npx @smittdev/next-jwt-auth add oauth` to add OAuth provider support.",
    );
  };
}
