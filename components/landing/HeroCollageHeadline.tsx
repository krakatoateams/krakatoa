const headlineSize = "clamp(2rem, 6.5vw, 4.25rem)";
const emojiBoxClass =
  "font-emoji inline-flex align-middle items-center justify-center shrink-0 h-[70px] text-[2.5rem] leading-none";

function HeroEmojiPill({ emoji }: { emoji: string }) {
  return (
    <span
      className={`${emojiBoxClass} overflow-hidden rounded-full bg-lime-400 mx-2 sm:mx-3 w-[140px]`}
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
      className={`${emojiBoxClass} overflow-hidden rounded-full bg-sky-200 mx-2 sm:mx-3 w-[70px] ring-2 ring-white shadow-sm`}
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
      className={`${emojiBoxClass} mx-2 sm:mx-3 w-[70px] bg-violet-200 shadow-sm`}
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

function HeroHexBadge({ emoji }: { emoji: string }) {
  return (
    <span
      className={`${emojiBoxClass} mx-1.5 sm:mx-2 w-[70px] bg-amber-300`}
      style={{
        clipPath: "polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)",
      }}
      role="img"
      aria-hidden
    >
      {emoji}
    </span>
  );
}

const lineClass = "flex flex-wrap items-center justify-center gap-x-1 gap-y-2";

export function HeroCollageHeadline() {
  return (
    <h1
      className="font-semibold leading-[1.1] tracking-[-0.03em] text-gray-900 max-w-5xl mx-auto text-center"
      style={{ fontSize: headlineSize }}
    >
      <span className={lineClass}>
        Everything
        <HeroEmojiPill emoji="🎬" />
        You
      </span>
      <span className={`${lineClass} mt-4 sm:mt-5`}>
        Need
        <HeroScallopBadge emoji="🏷️" />
        To Grow Your
        <HeroHexBadge emoji="✦" />
      </span>
      <span className={`${lineClass} mt-4 sm:mt-5`}>
        Content
        <HeroEmojiCircle emoji="📈" />
        Reach
      </span>
    </h1>
  );
}
