# TradeOS mobile app

Android-first access to the existing TradeOS backend. The APK renders the existing TradeOS web login and permission-scoped workspace full-screen instead of maintaining a separately designed business interface. Owners and administrators use secure Google authentication, while employees retain native background duty tracking alongside the same web workspace. The app does not create a second business, employee, or tracking database.

## Behavior

- An owner or administrator signs in with Google through the Android system browser and opens the existing TradeOS workspace in the app.
- An employee signs in using the same TradeOS profile ID and password, opens the existing permission-scoped workspace, and can switch to the native duty tracker.
- Tracking begins only after the employee reads the prominent disclosure, consents, grants foreground/background location permission, and taps **Start duty tracking**.
- Android runs a location foreground service with a permanent notification, so updates can continue with the screen off or the app minimized.
- Points are uploaded every 30 seconds or after approximately 25 metres of movement.
- Failed uploads are queued locally and retried later.
- The server returns the organization cutoff (16:00 by default). At that time,
  the server closes duty and attendance, the phone stops native collection,
  and points captured after the cutoff are rejected.
- **Stop duty** stops native collection immediately and closes both the TradeOS
  duty session and that day's attendance record.
- A previous day's session is never resumed automatically. The employee must
  tap **Start duty tracking** again on the next configured working day.
- Force-stopping the app, disabling GPS, revoking permission, or device-vendor battery restrictions can still stop location updates. No mobile operating system guarantees invisible, unstoppable tracking.

## Local setup

1. Copy `.env.example` to `.env`.
2. Set the deployed HTTPS TradeOS URL, Supabase URL, and Supabase anon key.
3. Run `npm install` inside `mobile`.
4. Run `npx expo prebuild --platform android` and then `npx expo run:android` with Android Studio/device tooling installed.

Expo Go cannot test this background service. Use a development or release build.

## Internal APK

Install EAS CLI, authenticate with the organization’s Expo account, then run:

```text
npx eas build --platform android --profile preview
```

The `preview` profile produces an internally distributable APK. Production Play Store builds use the `production` profile.

## Store/privacy checklist

- Publish a privacy policy describing precise background location, purpose, retention, access, and deletion.
- Complete Google Play’s background-location permission declaration and Data safety form.
- Provide reviewer credentials and a video showing disclosure, permission, Start duty, persistent notification, and Stop duty.
- Track during work/duty sessions only. Define an organization retention period and restrict history access to authorized management.
- Test on Samsung, Xiaomi, Oppo/Realme, Vivo, and other devices used by field staff because manufacturer battery controls differ.
