import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { createClient } from "@supabase/supabase-js";
import { saveSession } from "./storage";
import type { StoredSession } from "./types";

WebBrowser.maybeCompleteAuthSession();

const API_URL = (process.env.EXPO_PUBLIC_TRADEOS_API_URL ?? "").replace(/\/$/, "");
const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});

type ProvisionResponse = {
  ok?: boolean;
  error?: string;
  needsOnboarding?: boolean;
};

export type OwnerLoginResult = {
  destination: "/" | "/onboarding";
};

function requireConfiguration() {
  if (!API_URL || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Mobile environment is incomplete. Configure the TradeOS API URL and Supabase public settings.");
  }
}

async function provisionOwner(accessToken: string): Promise<ProvisionResponse> {
  const response = await fetch(`${API_URL}/api/auth/provision`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const data = await response.json().catch(() => ({} as ProvisionResponse));
  if (!response.ok || !data.ok) {
    throw new Error(data.error ?? "TradeOS could not prepare the owner workspace.");
  }
  return data;
}

function storedSession(session: { access_token: string; refresh_token: string }): StoredSession {
  return { accessToken: session.access_token, refreshToken: session.refresh_token };
}

export async function signInOwnerWithGoogle(): Promise<OwnerLoginResult> {
  requireConfiguration();
  const redirectTo = makeRedirectUri({ scheme: "tradeos", path: "auth/callback" });
  const { data: oauth, error: oauthError } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (oauthError || !oauth.url) {
    throw new Error(oauthError?.message ?? "Google sign in could not be started.");
  }

  const browserResult = await WebBrowser.openAuthSessionAsync(oauth.url, redirectTo);
  if (browserResult.type === "cancel" || browserResult.type === "dismiss") {
    throw new Error("Google sign in was cancelled.");
  }
  if (browserResult.type !== "success" || !browserResult.url) {
    throw new Error("Google did not return a valid TradeOS sign-in response.");
  }

  const callbackUrl = new URL(browserResult.url);
  const callbackError = callbackUrl.searchParams.get("error_description") ?? callbackUrl.searchParams.get("error");
  if (callbackError) throw new Error(callbackError);
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("Google sign in did not return an authorization code.");

  const { data: exchange, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !exchange.session) {
    throw new Error(exchangeError?.message ?? "TradeOS could not complete Google sign in.");
  }

  const provision = await provisionOwner(exchange.session.access_token);
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
    refresh_token: exchange.session.refresh_token,
  });
  if (refreshError || !refreshed.session) {
    throw new Error(refreshError?.message ?? "TradeOS could not refresh the owner workspace session.");
  }
  await saveSession(storedSession(refreshed.session));

  return { destination: provision.needsOnboarding ? "/onboarding" : "/" };
}
