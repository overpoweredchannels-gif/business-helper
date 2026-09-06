import { SafeAreaView } from "react-native-safe-area-context";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent, WebViewNavigation } from "react-native-webview";

const API_URL = (process.env.EXPO_PUBLIC_TRADEOS_API_URL ?? "").replace(/\/$/, "");

export type WebLoginSession = {
  accessToken: string;
  refreshToken: string;
  role: string | null;
  accountMode: "employee" | "owner";
};

type TradeOSLoginProps = {
  onGoogleSignIn: () => void;
  onSession: (session: WebLoginSession) => void;
};

export function TradeOSLogin({ onGoogleSignIn, onSession }: TradeOSLoginProps) {
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const appOrigin = (() => {
    try { return new URL(API_URL).origin; } catch { return ""; }
  })();

  const allowNavigation = (navigation: WebViewNavigation) => {
    if (navigation.url === "about:blank") return true;
    try {
      const url = new URL(navigation.url);
      if (url.origin === appOrigin) return true;
      if (url.protocol === "http:" || url.protocol === "https:") {
        void Linking.openURL(navigation.url);
      }
    } catch {
      // Ignore malformed or unsupported navigation targets.
    }
    return false;
  };

  const receiveMessage = (event: WebViewMessageEvent) => {
    try {
      if (new URL(event.nativeEvent.url).origin !== appOrigin) return;
      const message = JSON.parse(event.nativeEvent.data) as Record<string, unknown>;
      if (message.type === "tradeos-google-sign-in") {
        onGoogleSignIn();
        return;
      }
      if (
        message.type === "tradeos-auth-session" &&
        typeof message.accessToken === "string" &&
        typeof message.refreshToken === "string"
      ) {
        onSession({
          accessToken: message.accessToken,
          refreshToken: message.refreshToken,
          role: typeof message.role === "string" ? message.role : null,
          accountMode: message.accountMode === "employee" ? "employee" : "owner",
        });
      }
    } catch {
      // Ignore messages that were not emitted by the TradeOS web login.
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {error ? <View style={{ padding: 24, gap: 16 }}><Text>{error}</Text><Pressable onPress={() => { setError(null); setRetry((value) => value + 1); }} style={{ padding: 16, backgroundColor: "#e2e8f0" }}><Text>Retry connection</Text></Pressable></View> :
      <WebView
        key={retry}
        source={{ uri: `${API_URL}/login?tradeosMobile=1` }}
        onShouldStartLoadWithRequest={allowNavigation}
        onMessage={receiveMessage}
        onError={() => setError("TradeOS could not be reached. Check your connection, then retry.")}
        onHttpError={(event) => { if (event.nativeEvent.statusCode >= 500) setError("TradeOS is temporarily unavailable. Please retry."); }}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        setSupportMultipleWindows={false}
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        style={styles.webView}
      />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  webView: { flex: 1, backgroundColor: "#ffffff" },
});
