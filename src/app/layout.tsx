import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./workspace.css";
import AppHelp from "@/components/help/AppHelp";
import { AppFooter } from "@/components/branding/AppFooter";
import { DesktopUpdatesProvider } from "@/components/branding/DesktopUpdates";
import DesktopAuthCallbackListener from "@/components/ui/DesktopAuthCallbackListener";
import { RegionalProvider } from "@/components/regional/RegionalProvider";
import { LANGUAGE_BOOTSTRAP_SCRIPT } from "@/lib/regional/settings";
import { regionalQaEnabled } from "@/lib/regional/qa";
import { DISPLAY_ZOOM_BOOTSTRAP_SCRIPT } from "@/lib/preferences/display-zoom";

// Self-hosted latin woff2 files (Google Fonts binaries, committed to the
// repo). next/font/google is a build-time fetch: Turbopack serialises the
// font URL Google serves into an internal import query, and Google
// occasionally serves a URL containing "&" (or with no file extension),
// which breaks the build with "next/font/google queries have exactly one
// entry" / "Can't resolve '@vercel/turbopack-next/internal/font/google/font'"
// (vercel/next.js#99114, still open). Desktop run #8 passed and run #9
// failed with identical code — the failure depends on what Google serves at
// build time. Self-hosting removes the network dependency from every build;
// the families, weights and CSS variables are unchanged. Plus Jakarta Sans
// is a variable font (wght 200-800); the woff2 covers the 400-700 range.
const plusJakartaSans = localFont({
  src: "./fonts/plus-jakarta-sans-latin.woff2",
  variable: "--font-plus-jakarta",
  weight: "400 700",
  display: "swap",
});

const libreBaskerville = localFont({
  src: "./fonts/libre-baskerville-700-latin.woff2",
  variable: "--font-libre-baskerville",
  weight: "700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aankh",
  description: "The eye of your business — business management for traders, wholesalers, and retailers",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Aankh",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/aankh-app-eye.png",
    apple: "/aankh-apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#23140C",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plusJakartaSans.variable} ${libreBaskerville.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_ZOOM_BOOTSTRAP_SCRIPT }} />
        {regionalQaEnabled() && <script dangerouslySetInnerHTML={{ __html: LANGUAGE_BOOTSTRAP_SCRIPT }} />}
      </head>
      <body className="min-h-full flex flex-col">
        <RegionalProvider>
          <DesktopUpdatesProvider>
            <DesktopAuthCallbackListener />
            {children}
            <AppFooter />
            <AppHelp />
          </DesktopUpdatesProvider>
        </RegionalProvider>
      </body>
    </html>
  );
}
