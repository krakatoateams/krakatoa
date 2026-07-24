-- 046_posts_photo_urls.sql
-- Support TikTok photo posts (a carousel of 1-35 images) alongside the
-- existing single-video posts (tiktok-photo-post change).
--
-- A post is a "photo post" exactly when photo_urls is non-empty — no
-- separate post-type/media-type column is introduced, mirroring how a
-- "video post" today is simply one where video_url is set. This avoids an
-- invariant (post_type vs which URL column is populated) that could drift.
--
-- TikTok-only: YouTube has no photo-post concept, so photo_urls is always
-- NULL/empty for YouTube-targeted posts.
--
-- Existing tiktok_publish_id / tiktok_privacy_level / tiktok_brand_organic_toggle /
-- tiktok_brand_content_toggle (045_posts_tiktok_fields.sql) are reused unchanged
-- for photo posts — same idempotency + compliance semantics regardless of
-- whether the underlying publish was a video or a photo carousel.
--
-- Idempotent: `add column if not exists` is a no-op on re-run.

alter table posts add column if not exists photo_urls text[];

comment on column posts.photo_urls is
  'Ordered list of public photo URLs for a TikTok photo post (1-35 images, first = cover). NULL/empty for video posts and for all YouTube posts. Populated only via the tiktok-photo-post scheduler flow.';
