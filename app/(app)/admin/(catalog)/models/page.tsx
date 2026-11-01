"use client";

import { Suspense } from "react";
import { AdminModelsSkeleton } from "../../admin-ui";
import { AdminModelsView } from "../AdminCatalog";

export default function AdminModelsPage() {
  // AdminModelsView reads ?tool= (useSearchParams).
  return (
    <Suspense fallback={<AdminModelsSkeleton />}>
      <AdminModelsView />
    </Suspense>
  );
}
