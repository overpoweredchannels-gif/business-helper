import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";
import { getSession } from "./storage";

const API_URL = (process.env.EXPO_PUBLIC_TRADEOS_API_URL ?? "").replace(/\/$/, "");

type TradeOSWorkspaceProps = {
  destination: "/" | "/onboarding";
  onSignOut: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
};

export function TradeOSWorkspace({ destination, onSignOut, secondaryActionLabel, onSecondaryAction }: TradeOSWorkspaceProps) {
  const webView = useRef<WebView>(null);
  const [request, setRequest] = useState<{
    uri: string;
    method: "POST";
    headers: Record<string, string>;
    body: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack) return false;
      webView.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack]);
  const appOrigin = useMemo(() => {
    try { return new URL(API_URL).origin; } catch { return ""; }
  }, []);

  useEffect(() => {
    setError(null);
    void getSession().then((session) => {
      if (!session || !API_URL) {
        setError("Your TradeOS session is unavailable. Sign in again.");
        return;
      }
      setRequest({
        uri: `${API_URL}/api/auth/mobile-session`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          destination,
        }),
      });
    }).catch(() => setError("Your TradeOS session could not be opened."));
  }, [destination, retry]);

  const allowNavigation = (navigation: WebViewNavigation) => {
    if (navigation.url === "about:blank") return true;
    try {
      const url = new URL(navigation.url);
      if (url.origin === appOrigin) {
        if (url.pathname === "/login") {
          onSignOut();
          return false;
        }
        return true;
      }
      if (url.protocol === "http:" || url.protocol === "https:") {
        void Linking.openURL(navigation.url);
      }
    } catch {
      // Ignore malformed or unsupported navigation targets.
    }
    return false;
  };

  return (
    <SafeAreaView style={styles.safe}>
      {error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => setRetry((value) => value + 1)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Retry connection</Text></Pressable>
          <Pressable onPress={onSignOut} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Return to sign in</Text></Pressable>
        </View>
      ) : !request ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#2563eb" /><Text style={styles.muted}>Opening your workspace…</Text></View>
      ) : (
        <View style={styles.webContainer}>
          <WebView
            key={retry}
            ref={webView}
            source={request}
            onShouldStartLoadWithRequest={allowNavigation}
            onNavigationStateChange={(navigation) => setCanGoBack(navigation.canGoBack)}
            onRenderProcessGone={() => setError("Android paused this workspace. Tap Retry connection to reopen it.")}
            onHttpError={(event) => {
              if (event.nativeEvent.url.includes("/api/auth/mobile-session")) {
                setError(`TradeOS returned error ${event.nativeEvent.statusCode}. Sign in again.`);
              }
            }}
            onError={() => setError("The TradeOS workspace could not be reached. Check your connection and try again.")}
            startInLoadingState
            renderLoading={() => <View style={styles.loadingOverlay}><ActivityIndicator size="large" color="#2563eb" /></View>}
            javaScriptEnabled
            geolocationEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            setSupportMultipleWindows={false}
            setBuiltInZoomControls={false}
            setDisplayZoomControls={false}
            style={styles.webView}
          />
          {secondaryActionLabel && onSecondaryAction && (
            <Pressable onPress={onSecondaryAction} style={styles.floatingAction}>
              <Text style={styles.floatingActionText}>{secondaryActionLabel}</Text>
            </Pressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  webContainer: { flex: 1 },
  webView: { flex: 1 },
  floatingAction: { backgroundColor: "#2563eb", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14 },
  floatingActionText: { color: "#ffffff", fontWeight: "800", fontSize: 13 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 14 },
  loadingOverlay: { position: "absolute", inset: 0, justifyContent: "center", alignItems: "center", backgroundColor: "#ffffff" },
  muted: { color: "#64748b", fontSize: 13 },
  error: { color: "#b91c1c", backgroundColor: "#fef2f2", borderColor: "#fecaca", borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 13 },
  primaryButton: { backgroundColor: "#2563eb", borderRadius: 12, paddingHorizontal: 18, paddingVertical: 13 },
  primaryButtonText: { color: "#ffffff", fontWeight: "700" },
});
