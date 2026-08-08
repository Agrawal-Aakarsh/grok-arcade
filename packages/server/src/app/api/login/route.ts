/**
 * POST /api/login  { handle, token? } -> { handle, token }
 *
 * First claim on a handle wins and mints a device token; later logins must
 * present it. This is an honour system with one property that matters: nobody
 * else can overwrite your scores once you have claimed your handle. Real X
 * OAuth is the production path, documented as such in the README.
 */

import { enforceRateLimit, fail, normaliseHandle, ok } from "@/lib/api";
import { getStore } from "@/lib/store";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid json");
  }

  const { handle: rawHandle, token } = (body ?? {}) as { handle?: unknown; token?: unknown };
  const handle = normaliseHandle(rawHandle);
  if (!handle) return fail(400, "handle must be 1-15 chars: letters, digits, underscore");

  const limited = await enforceRateLimit(request, "login", handle);
  if (limited) return limited;

  const result = await getStore().claimHandle(handle, typeof token === "string" ? token : undefined);
  if (!result.ok) {
    return fail(409, `@${handle} is already claimed on this arcade`, { handle });
  }
  return ok({ handle, token: result.token });
}
