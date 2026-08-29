import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { getDutyStatus, loadOwnerIdentity, loadStaffIdentity, login, reportTrackingHealth, revokeServerSession, startDuty, stopDuty, uploadLocation } from "./src/api";
import {
  flushQueuedLocations,
  getCurrentSample,
  requestTrackingPermissions,
  startBackgroundTracking,
  stopBackgroundTracking,
} from "./src/background-location";
import {
  clearDutySessionId,
  clearQueuedLocations,
  clearSession,
  getAccountMode,
  getSession,
  hasLocationConsent,
  saveDutySessionId,
  saveDutyScheduledEndAt,
  saveAccountMode,
  setLocationConsent,
} from "./src/storage";
import { signInOwnerWithGoogle } from "./src/owner-auth";
import { TradeOSWorkspace } from "./src/TradeOSWorkspace";
import type { OwnerIdentity, StaffIdentity } from "./src/types";
import type { AccountMode } from "./src/storage";

export default function App() {
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [accountMode, setAccountMode] = useState<AccountMode | null>(null);
  const [loginMode, setLoginMode] = useState<AccountMode>("owner");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [identity, setIdentity] = useState<StaffIdentity | null>(null);
  const [ownerIdentity, setOwnerIdentity] = useState<OwnerIdentity | null>(null);
  const [ownerDestination, setOwnerDestination] = useState<"/" | "/onboarding">("/");
  const [employeeView, setEmployeeView] = useState<"workspace" | "duty">("workspace");
  const [onDuty, setOnDuty] = useState(false);
  const [dutyStartedAt, setDutyStartedAt] = useState<string | null>(null);
  const [scheduledEndAt, setScheduledEndAt] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    const [staff, status, storedConsent] = await Promise.all([
      loadStaffIdentity(),
      getDutyStatus(),
      hasLocationConsent(),
    ]);
    setIdentity(staff);
    setConsented(storedConsent);
    setOnDuty(status.onDuty);
    setDutyStartedAt(status.startedAt);
    setScheduledEndAt(status.scheduledEndAt);
    if (!status.onDuty || !status.dutySessionId || !status.scheduledEndAt) {
      await stopBackgroundTracking();
      await clearDutySessionId();
      // Valid points captured before a cutoff may still be queued because the
      // phone was offline at the end of duty. Replay them against the closed
      // session so the route history remains complete.
      await flushQueuedLocations().catch(() => undefined);
      if (status.lastEndedReason === "automatic_cutoff") {
        setMessage("Duty ended automatically at the scheduled cutoff. Tap Start duty on the next working day.");
      }
      return;
    }
    if (status.onDuty && status.dutySessionId && status.scheduledEndAt) {
      await Promise.all([
        saveDutySessionId(status.dutySessionId),
        saveDutyScheduledEndAt(status.scheduledEndAt),
      ]);
      const [foreground, background] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
      ]);
      if (storedConsent && foreground.granted && background.granted) {
        await startBackgroundTracking();
        await flushQueuedLocations();
        setMessage("Active duty session restored. Background tracking is running.");
      } else {
        await stopBackgroundTracking();
        setMessage("An active duty session exists. Tap Resume tracking to continue sharing location.");
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [session, storedMode] = await Promise.all([getSession(), getAccountMode()]);
        if (!session) return;
        const mode = storedMode ?? "employee";
        if (mode === "owner") {
          const owner = await loadOwnerIdentity();
          setOwnerIdentity(owner);
        } else {
          await loadWorkspace();
        }
        setAccountMode(mode);
        setAuthenticated(true);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not restore the mobile session.");
      } finally {
        setBooting(false);
      }
    })();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!onDuty || !scheduledEndAt) return;
    const remaining = new Date(scheduledEndAt).getTime() - Date.now();
    const stopAtCutoff = async () => {
      await stopBackgroundTracking().catch(() => undefined);
      await clearDutySessionId();
      setOnDuty(false);
      setDutyStartedAt(null);
      setScheduledEndAt(null);
      setMessage("Duty ended automatically at the scheduled cutoff. Start duty again on the next working day.");
    };
    if (remaining <= 0) {
      void stopAtCutoff();
      return;
    }
    const timer = setTimeout(() => void stopAtCutoff(), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [onDuty, scheduledEndAt]);

  const signIn = async () => {
    if (!loginId.trim() || !password) {
      setError("Enter your TradeOS profile ID and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(loginId, password);
      await saveAccountMode("employee");
      setPassword("");
      await loadWorkspace();
      setAccountMode("employee");
      setAuthenticated(true);
      setMessage("Signed in successfully.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const signInOwner = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await signInOwnerWithGoogle();
      await saveAccountMode("owner");
      const owner = await loadOwnerIdentity();
      setOwnerIdentity(owner);
      setOwnerDestination(result.destination);
      setAccountMode("owner");
      setAuthenticated(true);
      setMessage("Signed in successfully.");
    } catch (reason) {
      await clearSession().catch(() => undefined);
      setError(reason instanceof Error ? reason.message : "Google sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const changeConsent = async (value: boolean) => {
    if (onDuty && !value) {
      Alert.alert("Stop duty first", "Location consent cannot be withdrawn while a duty session is active. Stop duty, then turn this off.");
      return;
    }
    setConsented(value);
    await setLocationConsent(value);
  };

  const beginDuty = async () => {
    if (!consented) {
      setError("Read the disclosure and enable consent before starting duty tracking.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage("Requesting location permission and acquiring a precise GPS fix…");
    let createdSessionId: string | null = null;
    try {
      await requestTrackingPermissions();
      const point = await getCurrentSample();
      const duty = await startDuty(point);
      createdSessionId = duty.dutySessionId;
      if (!createdSessionId || !duty.scheduledEndAt) throw new Error("TradeOS did not return a complete duty session.");
      await Promise.all([
        saveDutySessionId(createdSessionId),
        saveDutyScheduledEndAt(duty.scheduledEndAt),
      ]);
      await uploadLocation(createdSessionId, point);
      await startBackgroundTracking();
      await reportTrackingHealth("tracking").catch(() => undefined);
      setOnDuty(true);
      setDutyStartedAt(duty.startedAt);
      setScheduledEndAt(duty.scheduledEndAt);
      setMessage("Duty tracking is active until the scheduled cutoff. You may minimize the app; the Android notification must remain visible.");
    } catch (reason) {
      const reasonMessage = reason instanceof Error ? reason.message : "Could not start duty tracking.";
      const health = /permission/i.test(reasonMessage) ? "permission_denied" : /location|gps/i.test(reasonMessage) ? "gps_disabled" : "error";
      await reportTrackingHealth(health, reasonMessage).catch(() => undefined);
      if (createdSessionId) {
        await stopDuty().catch(() => undefined);
        await clearDutySessionId();
      }
      setError(reasonMessage);
      setMessage(null);
    } finally {
      setBusy(false);
    }
  };

  const resumeDuty = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await getDutyStatus();
      if (!status.onDuty || !status.dutySessionId || !status.scheduledEndAt) {
        setOnDuty(false);
        throw new Error("No active duty session exists. Start duty again.");
      }
      await requestTrackingPermissions();
      await Promise.all([
        saveDutySessionId(status.dutySessionId),
        saveDutyScheduledEndAt(status.scheduledEndAt),
      ]);
      await startBackgroundTracking();
      await flushQueuedLocations();
      await reportTrackingHealth("tracking").catch(() => undefined);
      setOnDuty(true);
      setDutyStartedAt(status.startedAt);
      setScheduledEndAt(status.scheduledEndAt);
      setMessage("Background tracking resumed.");
    } catch (reason) {
      const reasonMessage = reason instanceof Error ? reason.message : "Could not resume tracking.";
      const health = /permission/i.test(reasonMessage) ? "permission_denied" : /location|gps/i.test(reasonMessage) ? "gps_disabled" : "error";
      await reportTrackingHealth(health, reasonMessage).catch(() => undefined);
      setError(reasonMessage);
    } finally {
      setBusy(false);
    }
  };

  const endDuty = async () => {
    setBusy(true);
    setError(null);
    try {
      await stopBackgroundTracking();
      let queueWarning: string | null = null;
      try {
        await flushQueuedLocations();
      } catch (reason) {
        queueWarning = reason instanceof Error ? reason.message : "Queued locations could not be uploaded yet.";
      }
      await stopDuty();
      await clearDutySessionId();
      setOnDuty(false);
      setDutyStartedAt(null);
      setScheduledEndAt(null);
      setMessage(queueWarning ? `Duty ended. Location sharing is off. ${queueWarning}` : "Duty ended. Location sharing is off.");
    } catch (reason) {
      await clearDutySessionId();
      setOnDuty(false);
      setDutyStartedAt(null);
      setScheduledEndAt(null);
      setError(reason instanceof Error ? `${reason.message} Location collection on this phone has been stopped.` : "Location collection stopped, but TradeOS could not close the server duty session.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await stopBackgroundTracking();
      if (onDuty) {
        await stopDuty().catch(() => undefined);
      }
      await revokeServerSession();
      await clearSession();
      await clearQueuedLocations();
      setAuthenticated(false);
      setAccountMode(null);
      setIdentity(null);
      setOwnerIdentity(null);
      setOwnerDestination("/");
      setEmployeeView("workspace");
      setOnDuty(false);
      setDutyStartedAt(null);
      setScheduledEndAt(null);
      setMessage(null);
      setError(null);
    } finally {
      setBusy(false);
    }
  };

  if (booting) {
    return <SafeAreaView style={styles.center}><StatusBar style="auto" /><ActivityIndicator size="large" color="#2563eb" /><Text style={styles.muted}>Opening TradeOS…</Text></SafeAreaView>;
  }

  if (!authenticated) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="auto" />
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}><Text style={styles.brandTitle}>TradeOS</Text><Text style={styles.muted}>Your complete business and workforce workspace</Text></View>
          <View style={styles.card}>
            <Text style={styles.heading}>Sign in</Text>
            <View style={styles.modeRow}>
              <Pressable disabled={busy} onPress={() => { setLoginMode("owner"); setError(null); }} style={[styles.modeButton, loginMode === "owner" && styles.modeButtonActive]}><Text style={[styles.modeButtonText, loginMode === "owner" && styles.modeButtonTextActive]}>Owner / Admin</Text></Pressable>
              <Pressable disabled={busy} onPress={() => { setLoginMode("employee"); setError(null); }} style={[styles.modeButton, loginMode === "employee" && styles.modeButtonActive]}><Text style={[styles.modeButtonText, loginMode === "employee" && styles.modeButtonTextActive]}>Employee</Text></Pressable>
            </View>
            {loginMode === "owner" ? (
              <>
                <Text style={styles.muted}>Owners and administrators use their existing Google account to open the complete TradeOS workspace.</Text>
                {error && <Text style={styles.error}>{error}</Text>}
                <Pressable disabled={busy} onPress={() => void signInOwner()} style={[styles.googleButton, busy && styles.disabled]}><Text style={styles.googleButtonText}>{busy ? "Connecting…" : "Continue with Google"}</Text></Pressable>
              </>
            ) : (
              <>
                <Text style={styles.muted}>Employees use the profile ID and password assigned by their organization.</Text>
                <Text style={styles.label}>Profile ID</Text>
                <TextInput value={loginId} onChangeText={setLoginId} autoCapitalize="characters" autoCorrect={false} style={styles.input} placeholder="Your TradeOS profile ID" />
                <Text style={styles.label}>Password</Text>
                <TextInput value={password} onChangeText={setPassword} secureTextEntry style={styles.input} placeholder="Password" />
                {error && <Text style={styles.error}>{error}</Text>}
                <Pressable disabled={busy} onPress={signIn} style={[styles.primaryButton, busy && styles.disabled]}><Text style={styles.primaryButtonText}>{busy ? "Signing in…" : "Sign in as employee"}</Text></Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (accountMode === "owner" && ownerIdentity) {
    return <TradeOSWorkspace destination={ownerDestination} accountName={ownerIdentity.displayName} onSignOut={() => void signOut()} />;
  }

  if (accountMode === "employee" && identity && employeeView === "workspace") {
    return (
      <TradeOSWorkspace
        destination="/"
        accountName={identity.employeeName}
        onSignOut={() => void signOut()}
        secondaryActionLabel="Duty"
        onSecondaryAction={() => setEmployeeView("duty")}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}><View><Text style={styles.brandTitle}>TradeOS Employee</Text><Text style={styles.muted}>{identity?.organizationName}</Text></View><View style={styles.headerActions}><Pressable disabled={busy} onPress={() => setEmployeeView("workspace")}><Text style={styles.link}>Workspace</Text></Pressable><Pressable disabled={busy} onPress={signOut}><Text style={styles.link}>Sign out</Text></Pressable></View></View>
        <View style={styles.card}>
          <Text style={styles.heading}>{identity?.employeeName ?? "Employee"}</Text>
          <Text style={styles.muted}>Scheduled duty: {identity?.dutyStart ?? "08:00"}–{identity?.dutyEnd ?? "16:00"}</Text>
          <View style={styles.statusRow}><View style={[styles.dot, onDuty ? styles.dotOn : styles.dotOff]} /><Text style={styles.statusText}>{onDuty ? "On duty — background tracking active or ready to resume" : "Off duty — location sharing is off"}</Text></View>
          {dutyStartedAt && <Text style={styles.small}>Duty started {new Date(dutyStartedAt).toLocaleString()}</Text>}
          {scheduledEndAt && <Text style={styles.small}>Automatic cutoff {new Date(scheduledEndAt).toLocaleString()}</Text>}
        </View>

        <View style={styles.disclosure}>
          <Text style={styles.disclosureTitle}>Background location disclosure</Text>
          <Text style={styles.disclosureText}>TradeOS Workforce collects precise location data to show your organization your route and duty location when the app is minimized or the screen is off. Tracking starts only after you tap Start duty, remains visible through a system notification, and ends when you tap Stop duty or when your organization&apos;s scheduled cutoff is reached. Location data is not collected while you are off duty.</Text>
          <View style={styles.consentRow}><Switch value={consented} onValueChange={(value) => void changeConsent(value)} disabled={onDuty} /><Text style={styles.consentText}>I understand and consent to duty-session location sharing.</Text></View>
        </View>

        {message && <Text style={styles.success}>{message}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}

        {!onDuty ? (
          <Pressable disabled={busy || !consented} onPress={beginDuty} style={[styles.primaryButton, (busy || !consented) && styles.disabled]}><Text style={styles.primaryButtonText}>{busy ? "Starting…" : "Start duty tracking"}</Text></Pressable>
        ) : (
          <View style={styles.actions}>
            <Pressable disabled={busy} onPress={resumeDuty} style={[styles.secondaryButton, busy && styles.disabled]}><Text style={styles.secondaryButtonText}>Resume tracking</Text></Pressable>
            <Pressable disabled={busy} onPress={endDuty} style={[styles.stopButton, busy && styles.disabled]}><Text style={styles.primaryButtonText}>{busy ? "Stopping…" : "Stop duty"}</Text></Pressable>
          </View>
        )}

        <Text style={styles.footnote}>Android keeps tracking active with a permanent notification. Force-stopping the app, disabling GPS, revoking permission, or some manufacturer battery controls can stop updates; reopen the app and tap Resume tracking.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f8fafc" },
  container: { padding: 20, gap: 16 },
  brand: { marginTop: 48, marginBottom: 12 },
  brandTitle: { fontSize: 24, fontWeight: "800", color: "#0f172a" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  card: { backgroundColor: "#ffffff", borderColor: "#e2e8f0", borderWidth: 1, borderRadius: 16, padding: 18, gap: 10 },
  heading: { fontSize: 19, fontWeight: "700", color: "#0f172a" },
  muted: { color: "#64748b", fontSize: 13 },
  small: { color: "#64748b", fontSize: 12 },
  label: { color: "#334155", fontWeight: "600", fontSize: 13, marginTop: 4 },
  input: { backgroundColor: "#ffffff", borderColor: "#cbd5e1", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, color: "#0f172a" },
  modeRow: { flexDirection: "row", backgroundColor: "#f1f5f9", borderRadius: 10, padding: 3, gap: 3 },
  modeButton: { flex: 1, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  modeButtonActive: { backgroundColor: "#ffffff", borderColor: "#cbd5e1", borderWidth: 1 },
  modeButtonText: { color: "#64748b", fontWeight: "700", fontSize: 13 },
  modeButtonTextActive: { color: "#0f172a" },
  primaryButton: { backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "700" },
  googleButton: { backgroundColor: "#ffffff", borderColor: "#cbd5e1", borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  googleButtonText: { color: "#0f172a", fontWeight: "700" },
  secondaryButton: { flex: 1, backgroundColor: "#ffffff", borderColor: "#2563eb", borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  secondaryButtonText: { color: "#2563eb", fontWeight: "700" },
  stopButton: { flex: 1, backgroundColor: "#dc2626", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  actions: { flexDirection: "row", gap: 10 },
  disabled: { opacity: 0.5 },
  link: { color: "#2563eb", fontWeight: "700" },
  error: { color: "#b91c1c", backgroundColor: "#fef2f2", borderColor: "#fecaca", borderWidth: 1, borderRadius: 10, padding: 11, fontSize: 13 },
  success: { color: "#166534", backgroundColor: "#f0fdf4", borderColor: "#bbf7d0", borderWidth: 1, borderRadius: 10, padding: 11, fontSize: 13 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  statusText: { flex: 1, color: "#334155", fontSize: 13, fontWeight: "600" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: "#16a34a" },
  dotOff: { backgroundColor: "#94a3b8" },
  disclosure: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe", borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  disclosureTitle: { color: "#1e3a8a", fontSize: 15, fontWeight: "800" },
  disclosureText: { color: "#1e3a8a", fontSize: 13, lineHeight: 19 },
  consentRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  consentText: { flex: 1, color: "#1e3a8a", fontSize: 13, fontWeight: "600" },
  footnote: { color: "#64748b", fontSize: 11, lineHeight: 16, textAlign: "center", paddingHorizontal: 8 },
});
