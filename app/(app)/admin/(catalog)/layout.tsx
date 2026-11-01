"use client";

import type { ReactNode } from "react";
import { AdminCatalogProvider } from "./AdminCatalog";

/** Config and Models tabs share one provider, so switching tabs keeps state and unsaved price drafts (#466). */
export default function AdminCatalogLayout({ children }: { children: ReactNode }) {
  return <AdminCatalogProvider>{children}</AdminCatalogProvider>;
}
