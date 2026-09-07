"use client";

import { createContext, useContext } from "react";
import type { CanvasNodeKind } from "@/lib/canvas-graph";
import type { CreationHistoryItem } from "@/lib/creations";

export type CanvasActions = {
  spawnFrom: (sourceId: string, kind: CanvasNodeKind) => void;
  attachLibraryRef: (targetId: string, item: CreationHistoryItem) => void;
  pushHistory: () => void;
};

const CanvasActionsContext = createContext<CanvasActions | null>(null);

export function CanvasActionsProvider({
  value,
  children,
}: {
  value: CanvasActions;
  children: React.ReactNode;
}) {
  return <CanvasActionsContext.Provider value={value}>{children}</CanvasActionsContext.Provider>;
}

export function useCanvasActions(): CanvasActions {
  return (
    useContext(CanvasActionsContext) ?? {
      spawnFrom: () => {},
      attachLibraryRef: () => {},
      pushHistory: () => {},
    }
  );
}
