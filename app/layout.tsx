import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Krakatoa - AI-powered tools for content creators",
  description: "Generate faceless reels, product photos, and automate your social media — all in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
