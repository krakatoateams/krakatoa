import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/Providers";
import "@/app/globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Krakatoa - AI-powered tools for content creators",
  description:
    "Generate faceless reels, product photos, and automate your social media — all in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${dmSans.variable}`}>
      <body className="font-body">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
