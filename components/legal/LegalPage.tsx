import Link from "next/link";

export type Block =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "h3"; text: string };

export type Section = {
  heading: string;
  blocks: Block[];
};

export type LangContent = {
  pageTitle: string;
  effectiveDate?: string;
  intro?: string;
  sections: Section[];
};

export type LegalContent = {
  indonesian: LangContent;
  english: LangContent;
};

function renderBlock(block: Block, idx: number) {
  switch (block.type) {
    case "h3":
      return (
        <h3
          key={idx}
          className="font-display mt-5 text-base font-semibold text-N900"
        >
          {block.text}
        </h3>
      );
    case "p":
      return (
        <p key={idx} className="mt-3 text-text-secondary leading-relaxed">
          {block.text}
        </p>
      );
    case "ul":
      return (
        <ul key={idx} className="mt-3 list-disc space-y-1.5 pl-5 text-text-secondary">
          {block.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              {item}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={idx} className="mt-3 list-decimal space-y-1.5 pl-5 text-text-secondary">
          {block.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              {item}
            </li>
          ))}
        </ol>
      );
  }
}

function LangSection({ content }: { content: LangContent }) {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold text-N900">{content.pageTitle}</h1>
      {content.effectiveDate && (
        <p className="mt-1.5 text-sm text-text-disabled">{content.effectiveDate}</p>
      )}
      {content.intro && (
        <p className="mt-4 text-text-secondary leading-relaxed">{content.intro}</p>
      )}
      <div className="mt-8 space-y-8">
        {content.sections.map((section, sIdx) => (
          <section key={sIdx}>
            <h2 className="font-display text-lg font-semibold text-N900">
              {section.heading}
            </h2>
            <div>{section.blocks.map((block, bIdx) => renderBlock(block, bIdx))}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function LegalPage({ content }: { content: LegalContent }) {
  return (
    <div className="min-h-screen bg-N0">
      {/* Minimal top bar */}
      <header className="border-b border-white/10 bg-N0">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <Link
            href="/"
            className="font-display text-base font-black tracking-[-1.5px] text-N900"
          >
            KELOLAKO.
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        {/* Draft notice banner */}
        <div className="mb-10 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p>
            <strong>Catatan:</strong> Dokumen ini masih dalam tahap penyusunan. Detail badan
            hukum sedang dalam proses pendaftaran usaha OSS Indonesia.
          </p>
          <p className="mt-1">
            <strong>Note:</strong> This document is a draft under active development. Business
            entity details are pending Indonesian OSS business registration completion.
          </p>
        </div>

        {/* Indonesian content */}
        <LangSection content={content.indonesian} />

        {/* Language divider */}
        <div className="my-14 flex items-center gap-4">
          <div className="h-px flex-1 bg-white/10" />
          <span className="font-display text-xs font-semibold tracking-widest text-text-disabled">
            ENGLISH
          </span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        {/* English content */}
        <LangSection content={content.english} />

        {/* Footer */}
        <div className="mt-16 border-t border-white/10 pt-6 text-center text-xs text-text-disabled">
          <p>
            Informasi pada halaman ini dapat berubah sewaktu-waktu tanpa pemberitahuan sebelumnya.
          </p>
          <p className="mt-1">
            Information on this page is subject to change at any time without prior notice.
          </p>
          <p className="mt-4">© {new Date().getFullYear()} Kelolako. All rights reserved.</p>
        </div>
      </main>
    </div>
  );
}
