"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Video, Camera, CalendarClock, Zap, X } from "lucide-react";

interface ToolModalContent {
  name: string;
  icon: React.ReactNode;
  tagline: string;
  description: string;
  capabilities: string[];
  comingSoon?: boolean;
}

const TOOLS: (ToolModalContent & { color: string; cardDescription: string })[] = [
  {
    name: "ReelsGen",
    icon: <Video className="w-6 h-6 text-indigo-400" />,
    color: "from-blue-500 to-indigo-600",
    cardDescription: "Generate faceless video reels with AI narration and captions automatically.",
    tagline: "AI video generation from text prompts",
    description:
      "Turn any idea into a scroll-stopping video reel in minutes. ReelsGen handles the visuals, voice, and captions — all you need is a topic.",
    capabilities: [
      "Generate faceless video reels automatically from a text prompt",
      "AI narration with natural-sounding voice synthesis",
      "Auto-generated captions and subtitles synced to audio",
      "Choose from multiple visual styles and formats",
    ],
  },
  {
    name: "Product Photo",
    icon: <Camera className="w-6 h-6 text-purple-400" />,
    color: "from-purple-500 to-pink-600",
    cardDescription: "Transform any product image into a professional studio shot with AI lighting.",
    tagline: "Transform product images with AI lighting",
    description:
      "Skip the photography studio. Upload any product photo and get back a professional, e-commerce-ready image with studio-quality lighting and backgrounds.",
    capabilities: [
      "Studio-quality lighting applied to any product photo",
      "Remove and replace backgrounds instantly",
      "Multiple lighting preset styles to match your brand",
      "Batch process multiple products at once",
    ],
  },
  {
    name: "Scheduler",
    icon: <CalendarClock className="w-6 h-6 text-emerald-400" />,
    color: "from-emerald-500 to-teal-600",
    cardDescription: "Intelligent scheduling that knows when your audience is most active.",
    tagline: "Schedule and auto-post to YouTube, TikTok, Instagram",
    description:
      "Upload once, publish everywhere — on your schedule. Krakatoa's Scheduler automatically posts your videos to YouTube at the exact time you choose, with AI-generated captions ready to go.",
    capabilities: [
      "Smart scheduling based on your audience's peak activity",
      "Auto-upload to YouTube on a set schedule",
      "AI-powered caption generation for every post",
      "Visual calendar view of all your scheduled content",
    ],
  },
  {
    name: "IG Automation",
    icon: <Zap className="w-6 h-6 text-amber-400" />,
    color: "from-amber-500 to-orange-600",
    cardDescription: "Auto-generate and post Instagram content on a schedule with smart engagement.",
    tagline: "Auto-generate and post Instagram content",
    description:
      "Keep your Instagram active on autopilot. IG Automation generates captions, picks the best times to post, and handles publishing so you don't have to.",
    capabilities: [
      "Auto-generate post captions tailored to your brand voice",
      "Schedule posts on a recurring basis",
      "Smart hashtag suggestions to boost reach",
      "Engagement analytics to see what's working",
    ],
    comingSoon: true,
  },
];

interface ToolsGridProps {
  isLoggedIn?: boolean;
}

export default function ToolsGrid({ isLoggedIn = false }: ToolsGridProps) {
  const [activeModal, setActiveModal] = useState<string | null>(null);

  const activeTool = TOOLS.find((t) => t.name === activeModal) ?? null;
  const ctaHref = isLoggedIn ? "/dashboard" : "/login";
  const ctaLabel = isLoggedIn ? "Go to Dashboard" : "Start Using This Tool";

  return (
    <>
      {/* Tools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {TOOLS.map((tool) => (
          <div
            key={tool.name}
            className="group relative bg-white/[0.03] border border-white/10 rounded-[2.5rem] p-10 hover:bg-white/[0.05] hover:border-white/20 transition-all duration-500 flex flex-col overflow-hidden"
          >
            {/* Hover glow */}
            <div
              className={`absolute -top-24 -right-24 w-48 h-48 bg-gradient-to-br ${tool.color} opacity-0 group-hover:opacity-20 blur-[60px] transition-opacity duration-500`}
            />

            {/* Coming Soon badge */}
            {tool.comingSoon && (
              <span className="absolute top-6 right-6 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold tracking-widest uppercase">
                Coming Soon
              </span>
            )}

            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500 border border-white/10">
              {tool.icon}
            </div>
            <h3 className="text-3xl font-bold mb-4 tracking-tight group-hover:text-indigo-400 transition-colors">
              {tool.name}
            </h3>
            <p className="text-slate-400 text-lg mb-12 flex-grow leading-relaxed">
              {tool.cardDescription}
            </p>

            <button
              type="button"
              onClick={() => setActiveModal(tool.name)}
              className="inline-flex items-center gap-3 text-white font-bold group-hover:gap-5 transition-all w-fit cursor-pointer"
            >
              Learn More
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
                <ArrowRight className="w-5 h-5" />
              </div>
            </button>
          </div>
        ))}
      </div>

      {/* Modal overlay */}
      {activeTool && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${activeTool.name} details`}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setActiveModal(null)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          {/* Modal panel */}
          <div
            className="relative z-10 w-full max-w-lg bg-[#0d0f18] border border-white/10 rounded-3xl p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              aria-label="Close modal"
              className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Icon + name */}
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 shrink-0">
                {activeTool.icon}
              </div>
              <div>
                <h3 className="text-2xl font-bold text-white">{activeTool.name}</h3>
                {activeTool.comingSoon && (
                  <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold tracking-widest uppercase">
                    Coming Soon
                  </span>
                )}
              </div>
            </div>

            {/* Tagline */}
            <p className="text-indigo-400 text-sm font-semibold uppercase tracking-widest mb-3">
              {activeTool.tagline}
            </p>

            {/* Description */}
            <p className="text-slate-300 text-base leading-relaxed mb-6">
              {activeTool.description}
            </p>

            {/* Capabilities */}
            <ul className="space-y-2.5 mb-8">
              {activeTool.capabilities.map((cap) => (
                <li key={cap} className="flex items-start gap-3 text-sm text-slate-400">
                  <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 block" />
                  </span>
                  {cap}
                </li>
              ))}
            </ul>

            {/* CTA */}
            <Link
              href={ctaHref}
              className="flex items-center justify-center gap-2 w-full px-6 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-indigo-900/40"
            >
              {ctaLabel}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
