"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import CreationsHistory from "@/components/CreationsHistory";
import { LibrarySectionNav } from "@/components/library/LibrarySectionNav";
import PageContainer from "../PageContainer";
import PageHeader from "../PageHeader";

export type LibrarySection = "browse" | "favorite" | "trash";

type Props = {
  title: string;
  section: LibrarySection;
};

export default function LibraryPageShell({ title, section }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey((k) => k + 1);
  const refreshButtonClass =
    "shrink-0 cursor-pointer rounded-radius-xl border border-white/10 bg-white/10 p-1.5 text-text-secondary transition-colors hover:border-white/20 hover:text-N900";

  return (
    <PageContainer>
      <PageHeader
        title={title}
        actions={
          <div className="flex w-full min-w-0 items-center justify-end gap-2">
            <LibrarySectionNav refreshKey={refreshKey} />
            <button
              type="button"
              onClick={bumpRefresh}
              aria-label="Refresh"
              className={refreshButtonClass}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        }
      />

      <CreationsHistory
        title="Your generations"
        description="Every successful generation appears here."
        className="!mt-0 !border-t-0 !pt-0"
        enableTabs
        librarySection={section}
        showMeta={false}
        showRefresh={false}
        limit={20}
        refreshKey={refreshKey}
      />
    </PageContainer>
  );
}
