const headlineSize = "clamp(2.25rem, 8.5vw, 5.875rem)";
const emojiBoxClass =
  "font-emoji inline-flex align-middle items-center justify-center shrink-0 h-[clamp(2.5rem,9vw,6rem)] text-[clamp(1.5rem,5.5vw,3.5rem)] leading-none";

function HeroEmojiPill({ emoji }: { emoji: string }) {
  return (
    <span
      className={`${emojiBoxClass} overflow-hidden rounded-full bg-lime-400 mx-2 sm:mx-3 w-[clamp(5rem,18vw,12rem)]`}
      role="img"
      aria-hidden
    >
      {emoji}
    </span>
  );
}

function HeroEmojiCircle({ emoji }: { emoji: string }) {
  return (
    <span
      className={`${emojiBoxClass} overflow-hidden rounded-full bg-sky-200 mx-2 sm:mx-3 w-[clamp(2.5rem,9vw,6rem)] ring-2 ring-white shadow-sm`}
      role="img"
      aria-hidden
    >
      {emoji}
    </span>
  );
}

function HeroScallopBadge({ emoji }: { emoji: string }) {
  return (
    <span
      className={`${emojiBoxClass} mx-2 sm:mx-3 w-[clamp(2.5rem,9vw,6rem)] bg-violet-200 shadow-sm`}
      style={{
        borderRadius: "38% 62% 58% 42% / 48% 38% 62% 52%",
      }}
      role="img"
      aria-hidden
    >
      {emoji}
    </span>
  );
}

const lineClass = "flex flex-wrap items-center justify-center gap-x-1 gap-y-2";

export function HeroCollageHeadline({
  tone = "dark",
}: { tone?: "dark" | "light" } = {}) {
  return (
    <h1
      className={`font-semibold leading-[1.1] tracking-[-0.03em] max-w-6xl mx-auto text-center ${
        tone === "light" ? "text-white" : "text-gray-900"
      }`}
      style={{ fontSize: headlineSize }}
    >
      <span className={lineClass}>
        Everything
        <HeroEmojiPill emoji="🎬" />
        You
      </span>
      <span className={`${lineClass} mt-5 sm:mt-6`}>
        Need
        <HeroScallopBadge emoji="🏷️" />
        To Grow Your
      </span>
      <span className={`${lineClass} mt-5 sm:mt-6`}>
        Content
        <HeroEmojiCircle emoji="📈" />
        Reach
      </span>
    </h1>
  );
}
