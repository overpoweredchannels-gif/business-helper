import { Linking, SafeAreaView, StyleSheet } from "react-native";
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
      <WebView
        source={{ uri: `${API_URL}/login?tradeosMobile=1` }}
        onShouldStartLoadWithRequest={allowNavigation}
        onMessage={receiveMessage}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        setSupportMultipleWindows={false}
        style={styles.webView}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  webView: { flex: 1, backgroundColor: "#ffffff" },
});
