-- 109_dashboard_templates_admin.sql
-- Extend trending_templates for admin-managed dashboard carousels (viral + motion control).
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).

alter table trending_templates add column if not exists kind text;
update trending_templates set kind = 'motion_control' where kind is null;
alter table trending_templates alter column kind set default 'motion_control';
alter table trending_templates alter column kind set not null;

do $$
begin
  alter table trending_templates
    add constraint trending_templates_kind_check
    check (kind in ('motion_control', 'viral'));
exception
  when duplicate_object then null;
end $$;

alter table trending_templates add column if not exists slug text;
alter table trending_templates add column if not exists generation_video_url text;
alter table trending_templates add column if not exists prompt text;
alter table trending_templates add column if not exists character_thumb_url text;
alter table trending_templates add column if not exists reference_image_url text;
alter table trending_templates add column if not exists product_thumb_url text;
alter table trending_templates add column if not exists skill_id text;
alter table trending_templates add column if not exists shot_count int;

create unique index if not exists trending_templates_slug_uq
  on trending_templates (slug)
  where slug is not null;

create index if not exists trending_templates_kind_sort_idx
  on trending_templates (kind, is_active, sort_order);
