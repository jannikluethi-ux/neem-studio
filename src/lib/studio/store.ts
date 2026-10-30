import { create } from "zustand";
import { persist } from "zustand/middleware";
import { migrateStudioDb } from "./engine";
import { RECORDED_CHARACTER_IMAGES } from "./generated/meethi-recorded";
import { installRecordedImage } from "./image";
import { buildSeedDb } from "./seed";
import type { Actor, Op, StudioDb } from "./types";

interface StudioState {
  db: StudioDb;
  flash: string | null;
  apply: (result: Op<unknown>) => void;
  replace: (db: StudioDb) => void;
  clearFlash: () => void;
}

function withRecorded(db: StudioDb): StudioDb {
  let next = db;
  for (const recorded of RECORDED_CHARACTER_IMAGES) {
    const filed = installRecordedImage(next, recorded, reviewer(next));
    if (filed.ok) next = filed.db;
  }
  return next;
}

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      db: withRecorded(buildSeedDb()),
      flash: null,
      apply: (result) => set({ db: result.db, flash: result.ok ? null : result.error }),
      replace: (db) => set({ db, flash: null }),
      clearFlash: () => set({ flash: null }),
    }),
    {
      name: "neem-studio-v1",
      skipHydration: true,
      partialize: (state) => ({ db: state.db }),
      merge: (persisted, current) => {
        const saved = persisted as { db?: StudioDb } | undefined;
        if (!saved?.db) return { ...current, db: withRecorded(buildSeedDb()) };
        return { ...current, db: withRecorded(migrateStudioDb(saved.db)) };
      },
    },
  ),
);

export function reviewer(db: StudioDb): Actor {
  return {
    type: "human",
    id: "human_reviewer",
    name: db.studio?.reviewerName?.trim() || "Studio lead",
  };
}