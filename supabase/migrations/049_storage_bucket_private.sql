-- Flip the krakatoa Storage bucket to private (Phase 5 cutover).
-- All reads go through signed URLs; writers use service role or signed upload URLs.
UPDATE storage.buckets
SET public = false
WHERE id = 'krakatoa';
