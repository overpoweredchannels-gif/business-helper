import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Libre_Baskerville } from "next/font/google";
import "./globals.css";

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
  title: "TradeOS",
  description: "Business operating system for traders, wholesalers, and retailers",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "TradeOS",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/tradeos-icon.svg",
    apple: "/tradeos-icon.svg",
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
    <html lang="en" className={`${plusJakartaSans.variable} ${libreBaskerville.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
