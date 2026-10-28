import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Libre_Baskerville } from "next/font/google";
import "./globals.css";
import AppHelp from "@/components/help/AppHelp";
import { AppFooter } from "@/components/branding/AppFooter";
import { DISPLAY_ZOOM_BOOTSTRAP_SCRIPT } from "@/lib/preferences/display-zoom";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-libre-baskerville",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AANKH",
  description: "The eye of your business — business management for traders, wholesalers, and retailers",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "AANKH",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/aankh-icon.svg",
    apple: "/aankh-icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#c15f3c",
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
      </head>
      <body className="min-h-full flex flex-col">{children}<AppFooter /><AppHelp /></body>
    </html>
  );
}
