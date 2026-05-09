import Link from 'next/link';
import { ArrowRight, Video, Camera, CalendarClock, Instagram } from 'lucide-react';

export default function Home() {
  const tools = [
    {
      name: 'ReelsGen',
      description: 'Generate faceless video reels with AI narration and captions.',
      href: '/tools/reels',
      icon: <Video className="w-6 h-6 text-indigo-600" />
    },
    {
      name: 'Product Photo',
      description: 'Transform any product image into a professional studio shot.',
      href: '/tools/photo',
      icon: <Camera className="w-6 h-6 text-indigo-600" />
    },
    {
      name: 'Scheduler',
      description: 'Schedule and automate your social media posts.',
      href: '/tools/scheduler',
      icon: <CalendarClock className="w-6 h-6 text-indigo-600" />
    },
    {
      name: 'IG Automation',
      description: 'Auto-generate and post Instagram content on a schedule.',
      href: '/tools/ig',
      icon: <Instagram className="w-6 h-6 text-indigo-600" />
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans">
      {/* Navbar */}
      <header className="w-full bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-2xl font-black tracking-tight text-indigo-700">
            Krakatoa
          </Link>
          <Link 
            href="#tools" 
            className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="w-full py-24 md:py-32 px-6 bg-white overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-30 pointer-events-none"></div>
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 text-slate-900">
            AI-powered tools for <br className="hidden md:block"/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600">
              content creators
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
            Generate faceless reels, product photos, and automate your social media — all in one place.
          </p>
          <Link 
            href="#tools" 
            className="inline-flex items-center px-8 py-4 text-lg font-semibold text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors shadow-lg hover:shadow-indigo-500/30 transform hover:-translate-y-0.5"
          >
            Explore Tools
            <ArrowRight className="w-5 h-5 ml-2" />
          </Link>
        </div>
      </section>

      {/* Tools Section */}
      <section id="tools" className="w-full py-20 px-6 bg-slate-50 flex-grow">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-slate-900">Our Suite of Tools</h2>
            <p className="text-slate-600 text-lg max-w-xl mx-auto">
              Everything you need to scale your content creation effortlessly.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {tools.map((tool) => (
              <div 
                key={tool.name} 
                className="group bg-white rounded-2xl p-8 border border-slate-200 shadow-sm hover:shadow-xl hover:border-indigo-100 transition-all duration-300 flex flex-col"
              >
                <div className="w-14 h-14 bg-indigo-50 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  {tool.icon}
                </div>
                <h3 className="text-2xl font-bold mb-3 text-slate-900">{tool.name}</h3>
                <p className="text-slate-600 text-lg mb-8 flex-grow">
                  {tool.description}
                </p>
                <Link 
                  href={tool.href} 
                  className="inline-flex items-center text-indigo-600 font-semibold group-hover:text-indigo-700 w-fit"
                >
                  Try it 
                  <ArrowRight className="w-5 h-5 ml-1 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full bg-white border-t border-slate-200 py-8 px-6">
        <div className="max-w-6xl mx-auto text-center text-slate-500 text-sm">
          &copy; 2025 Krakatoa. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
