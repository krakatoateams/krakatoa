import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";

// Suisse Intl (arqe.ai's typeface) is commercial; Inter Tight is the closest
// free neo-grotesque and carries the same compact, neutral Swiss proportions.
const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kelolako — Everything You Need To Grow Your Content Reach",
  description:
    "Generate faceless reels, cinematic clips, and studio-grade product photos with one AI suite.",
  // Design variant of "/" with identical copy — keep it out of the index so it
  // never competes with the canonical landing page.
  robots: { index: false, follow: false },
};

export default function HelloLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${interTight.className} min-h-screen bg-[#0a0a0a] antialiased`}>
      {children}
    </div>
  );
}
