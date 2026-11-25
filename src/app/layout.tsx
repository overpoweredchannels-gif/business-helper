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
  themeColor: "#FFFFFF",
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
    <html lang="en" suppressHydrationWarning className={`${libreBaskerville.variable} h-full antialiased`}>
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
