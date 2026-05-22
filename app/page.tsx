import Link from 'next/link';
import { ArrowRight, Mountain, BarChart3, ShieldCheck, Zap } from 'lucide-react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import ToolsGrid from './components/ToolsGrid';

export default async function Home() {
  // Server-side session check: returning visitors who are already
  // signed in shouldn't be forced back through the auth flow.
  const session = await getServerSession(authOptions);
  const isLoggedIn = !!session?.user;
  const ctaHref = isLoggedIn ? '/dashboard' : '/api/auth/signin';
  return (
    <div className="min-h-screen flex flex-col bg-[#030712] text-white font-sans selection:bg-indigo-500/30">
      {/* Background Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full animate-pulse"></div>
        <div className="absolute top-[20%] -right-[10%] w-[35%] h-[35%] bg-purple-600/20 blur-[120px] rounded-full animate-pulse [animation-delay:2s]"></div>
        <div className="absolute -bottom-[10%] left-[20%] w-[30%] h-[30%] bg-blue-600/10 blur-[100px] rounded-full animate-pulse [animation-delay:4s]"></div>
      </div>

      {/* Navbar */}
      <header className="w-full h-20 flex items-center justify-center sticky top-0 z-50 px-6 backdrop-blur-md border-b border-white/5 bg-black/20">
        <div className="max-w-7xl w-full flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-10 h-10 bg-gradient-to-tr from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-110 transition-transform">
              <Mountain className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
              Krakatoa
            </span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-400">
            <Link href="#tools" className="hover:text-white transition-colors">Tools</Link>
            <Link href="#" className="hover:text-white transition-colors">Features</Link>
            <Link href="#" className="hover:text-white transition-colors">Pricing</Link>
          </nav>

          <Link 
            href={ctaHref}
            className="px-6 py-2.5 text-sm font-bold text-white bg-white/10 hover:bg-white/20 border border-white/10 rounded-full transition-all backdrop-blur-sm shadow-xl"
          >
            {isLoggedIn ? 'Open Dashboard' : 'Get Started'}
          </Link>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero Section */}
        <section className="relative pt-24 pb-32 md:pt-40 md:pb-52 px-6 overflow-hidden">
          <div className="max-w-5xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-bold tracking-widest uppercase mb-8 animate-fade-in">
              <Zap className="w-3 h-3" />
              <span>Next Gen AI Platform</span>
            </div>
            <h1 className="text-6xl md:text-8xl font-black tracking-tight mb-8 leading-[0.9] md:leading-[0.9]">
              Scale your content <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-500">
                with intelligence.
              </span>
            </h1>
            <p className="text-lg md:text-xl text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed">
              The all-in-one creative engine for modern brands. Generate, automate, and dominate your social presence with Krakatoa&apos;s AI suite.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link 
                href={ctaHref}
                className="w-full sm:w-auto px-10 py-5 text-lg font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 rounded-2xl hover:scale-105 transition-all shadow-[0_0_40px_-10px_rgba(79,70,229,0.5)] flex items-center justify-center group"
              >
                {isLoggedIn ? 'Go to Dashboard' : 'Start Creating Free'}
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link 
                href="#tools"
                className="w-full sm:w-auto px-10 py-5 text-lg font-bold text-white bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all flex items-center justify-center"
              >
                Our Tools
              </Link>
            </div>
          </div>
        </section>

        {/* Tools Section */}
        <section id="tools" className="py-32 px-6 relative">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row items-end justify-between mb-20 gap-8">
              <div className="max-w-2xl">
                <h2 className="text-4xl md:text-5xl font-black mb-6 tracking-tight">Our Creative Suite</h2>
                <p className="text-slate-400 text-lg leading-relaxed">
                  Everything you need to scale your content creation effortlessly. From video generation to smart automation, we&apos;ve got you covered.
                </p>
              </div>
            </div>
            
            <ToolsGrid isLoggedIn={isLoggedIn} />
          </div>
        </section>

        {/* Features/Trust Section */}
        <section className="py-24 px-6 border-y border-white/5 bg-white/[0.01]">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12 text-center md:text-left">
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center mx-auto md:mx-0">
                <ShieldCheck className="w-6 h-6 text-blue-500" />
              </div>
              <h4 className="text-xl font-bold">Enterprise Security</h4>
              <p className="text-slate-400">Your data and assets are protected with industry-leading encryption and privacy standards.</p>
            </div>
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center mx-auto md:mx-0">
                <Zap className="w-6 h-6 text-purple-500" />
              </div>
              <h4 className="text-xl font-bold">Lightning Fast</h4>
              <p className="text-slate-400">Proprietary AI infrastructure designed for speed, delivering results in seconds, not hours.</p>
            </div>
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center mx-auto md:mx-0">
                <BarChart3 className="w-6 h-6 text-emerald-500" />
              </div>
              <h4 className="text-xl font-bold">Actionable Insights</h4>
              <p className="text-slate-400">Deep analytics to help you understand what content drives the most engagement.</p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full bg-black py-20 px-6 border-t border-white/5 relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-12">
          <div className="flex flex-col items-center md:items-start gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                <Mountain className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-black tracking-tighter">Krakatoa</span>
            </div>
            <p className="text-slate-500 text-sm max-w-xs text-center md:text-left">
              The next generation AI platform for creators and modern brands.
            </p>
          </div>
          
          <div className="flex gap-12 text-sm text-slate-500">
            <div className="flex flex-col gap-4">
              <span className="font-bold text-white uppercase tracking-widest text-xs">Product</span>
              <Link href="#" className="hover:text-white transition-colors">Tools</Link>
              <Link href="#" className="hover:text-white transition-colors">Features</Link>
              <Link href="#" className="hover:text-white transition-colors">API</Link>
            </div>
            <div className="flex flex-col gap-4">
              <span className="font-bold text-white uppercase tracking-widest text-xs">Company</span>
              <Link href="#" className="hover:text-white transition-colors">About</Link>
              <Link href="#" className="hover:text-white transition-colors">Blog</Link>
              <Link href="#" className="hover:text-white transition-colors">Careers</Link>
            </div>
          </div>

          <div className="text-slate-500 text-sm text-center md:text-right">
            &copy; 2025 Krakatoa. Built for the future of content.
          </div>
        </div>
      </footer>
    </div>
  );
}
