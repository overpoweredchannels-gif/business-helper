"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * Client-side fetch that attaches the current session's access token as a
 * Bearer header. TradeOS API routes require this header (they authenticate via
 * resolveActor / requireOwner / requirePermission).
 */
export async function authorizedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}