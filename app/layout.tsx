import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/Providers";
import { PwaRegister } from "@/components/PwaRegister";
import { Analytics } from "@vercel/analytics/next";
import "@/app/globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

// Design-system-v2's body font, promoted from being scoped to /design-system
// (see the removed --font-ds-body there) to the app-wide default — replaces
// DM Sans everywhere `.font-body`/`--font-body` is used, which is just this
// one place: <body className="font-body"> below.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

const SITE_TITLE = "Kelolako - AI-powered tools for content creators";
const SITE_DESCRIPTION =
  "Turn your photos into viral reels and create AI product photos, right in your browser.";
const OG_IMAGE = {
  url: "/og.jpg",
  width: 900,
  height: 473,
  alt: "Kelolako AI video templates and product photos",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://www.kelolako.com"),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Kelolako",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  applicationName: "Kelolako",
  manifest: "/site.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Kelolako",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  other: {
    "facebook-domain-verification": "43lx22iwu3kwq40pvf8vlfv8ymeccc",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} bg-N0`}>
      <body className="font-body bg-N0">
        <PwaRegister />
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
