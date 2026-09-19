# Krakatoa

AI-powered content creation and scheduling platform — generates video/photo content and publishes it to TikTok, Instagram, and YouTube.

## Language

**Carousel**:
A single scheduled post containing multiple photos, published to the platform as one unit. TikTok supports up to 35 photos per carousel; Instagram supports up to 10 items (photos and/or videos, mixed) per carousel.
_Avoid_: Multi-photo post, album, gallery post

**Separate posts**:
Multiple independent scheduled posts, each carrying exactly one photo, created from a single multi-file selection. The alternative to a Carousel when combining photos isn't wanted.
_Avoid_: Multi-post, batch posts, individual posts

**Platform availability**:
Whether a social platform (TikTok, Instagram, YouTube) can be used at all right now — product-wide, not scoped to any one tool. A single flag per platform governs both connecting the account (Settings) and selecting it in Schedule, because Schedule is currently the only feature that consumes these connections. Distinct from **Tool availability** (below): a tool can be fully available while one of the platforms it offers is not.
_Avoid_: Platform config, platform flag (as a synonym for the whole concept — those are the storage detail, not the concept)

**Tool availability**:
The existing, separate admin concept (`tool_configs`) governing a whole tool (e.g. Schedule, Canvas) in the sidebar: `enabled` (hides + blocks the tool entirely when false), `visible_in_sidebar`, and `coming_soon` (a purely cosmetic "Soon" badge — never blocks access on its own). Unlike Platform availability, Tool availability's "coming soon" state never blocks anyone, admin or not.
_Avoid_: Using "coming soon" alone to mean either concept — they behave differently (Tool availability's is cosmetic-only; Platform availability's actually blocks non-admins)

**Admin preview**:
The bypass that lets an admin use a platform marked coming-soon (per Platform availability) exactly as if it were live — full access to connect and schedule with it — while everyone else sees it disabled with a "Preview"-style badge instead of the normal locked "Soon" look. Scoped only to Platform availability; Tool availability has no equivalent bypass because its "coming soon" never blocks anyone in the first place.
_Avoid_: Admin bypass (as the primary term — "preview" is what the badge says, keep the glossary term matching the UI)
