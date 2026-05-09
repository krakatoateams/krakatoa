"use client";

import Link from "next/link";
import { ArrowLeft, Camera, Sparkles, Image as ImageIcon, Zap, Upload, Wand2 } from "lucide-react";

export default function ProductPhotoPage() {
  return (
    <div className="min-h-screen bg-[#030712] text-white selection:bg-purple-500/30">
      {/* Background Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-purple-900/20 rounded-full blur-[120px]" />
        <div className="absolute top-[20%] -right-[10%] w-[30%] h-[30%] bg-indigo-900/20 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        {/* Navigation */}
        <Link 
          href="/" 
          className="inline-flex items-center text-sm text-gray-400 hover:text-white transition-colors mb-12 group"
        >
          <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
          Back to Dashboard
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          {/* Header & Controls */}
          <div className="space-y-8">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium mb-4">
                <Sparkles className="w-3 h-3" />
                <span>AI Product Photography</span>
              </div>
              <h1 className="text-4xl font-bold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-gray-400">
                Transform your product photos
              </h1>
              <p className="text-lg text-gray-400 max-w-xl">
                Upload a simple photo and let our AI generate professional, studio-quality lifestyle shots in seconds.
              </p>
            </div>

            <div className="space-y-6">
              {/* Upload Area */}
              <div className="border-2 border-dashed border-white/5 bg-white/5 rounded-3xl p-12 text-center hover:border-purple-500/40 hover:bg-white/[0.07] transition-all cursor-pointer group">
                <div className="w-16 h-16 bg-purple-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                  <Upload className="w-8 h-8 text-purple-400" />
                </div>
                <h3 className="text-lg font-medium mb-2 text-white">Upload product image</h3>
                <p className="text-sm text-gray-400">PNG or JPG, high quality recommended</p>
              </div>

              {/* Style Selection */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { name: "Minimalist Studio", icon: <Camera className="w-4 h-4" /> },
                  { name: "Outdoor Lifestyle", icon: <ImageIcon className="w-4 h-4" /> },
                  { name: "Neon Tech", icon: <Zap className="w-4 h-4" /> },
                  { name: "Luxury Marble", icon: <Sparkles className="w-4 h-4" /> }
                ].map((style) => (
                  <button 
                    key={style.name}
                    className="flex items-center gap-3 p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/20 transition-all text-left group"
                  >
                    <div className="p-2 rounded-lg bg-white/5 text-gray-400 group-hover:text-white">
                      {style.icon}
                    </div>
                    <span className="text-sm font-medium text-gray-300 group-hover:text-white">{style.name}</span>
                  </button>
                ))}
              </div>

              <button className="w-full py-4 bg-white text-black rounded-2xl font-semibold hover:bg-gray-200 transition-all flex items-center justify-center gap-2 group">
                <Wand2 className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                Generate Visuals
              </button>
            </div>
          </div>

          {/* Preview Panel */}
          <div className="lg:sticky lg:top-12">
            <div className="aspect-[4/5] rounded-[2.5rem] bg-white/5 border border-white/5 relative overflow-hidden flex items-center justify-center group">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-50" />
              
              <div className="text-center relative z-10 px-8">
                <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mx-auto mb-6 backdrop-blur-xl border border-white/10">
                  <ImageIcon className="w-10 h-10 text-gray-500" />
                </div>
                <h3 className="text-xl font-medium text-white mb-2">Preview Generation</h3>
                <p className="text-gray-400">Your professional product photo will appear here after generation.</p>
              </div>

              {/* Decorative elements */}
              <div className="absolute bottom-8 left-8 right-8 p-4 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-xs text-gray-400 font-medium tracking-wider uppercase">Vibrant Studio • 4K</span>
                <Sparkles className="w-4 h-4 text-purple-400" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
