/**
 * Clips for the dashboard "Trending templates" carousel.
 *
 * Curated showcase content, identical for every user — so it lives here rather
 * than in Postgres. It used to be the `trending_templates` table, but with no
 * admin UI behind it, editing meant hand-writing UPDATEs in the SQL Editor;
 * that is not easier than editing this array, and it cost a table, an API
 * route, and a fetch on every dashboard load. The table still exists, unused.
 *
 * Served from R2 behind cdn.kelolako.com, not Supabase Storage: the carousel is
 * ~12 MB and every card autoplays, which made it a real chunk of the Storage
 * egress bill.
 */
const BASE = "https://cdn.kelolako.com/trending-template-1";

/** Carousel order. */
const FILES = [
  "2c90d936-07e9-4f0e-a0eb-fb7cdbf48228-8b28bde63ae889a5.mp4",
  "5fcbc237-7bfc-4275-8c8c-6c0c80eff401-dcb267808091d553.mp4",
  "71d459a3-7025-459b-82fb-8ba29008ba32-1c64ea186d659820.mp4",
  "9f4320b6-27ce-47dc-be0d-ebc98b232fef-4618b39cd3aedf6a.mp4",
  "eb68f0d4-6a2e-473b-ad39-a34c7e8b1d00-7fd7325a427ac5a7.mp4",
  "f6b20b46-4a5f-4514-91cf-c65d5ad10c82-bf553f1b0fd58f61.mp4",
];

export type TrendingTemplate = {
  id: string;
  videoUrl: string;
};

export const TRENDING_TEMPLATES: TrendingTemplate[] = FILES.map((file) => ({
  id: file,
  videoUrl: `${BASE}/${file}`,
}));
