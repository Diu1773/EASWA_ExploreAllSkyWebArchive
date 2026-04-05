import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Target, TransitTargetFilters } from '../types/target';

export const DEFAULT_TRANSIT_FILTERS: TransitTargetFilters = {
  maxTargets: 20,
  minDepthPct: 1.0,
  maxPeriodDays: 5.0,
  maxHostVmag: 13.0,
};

interface AppState {
  selectedTopic: string | null;
  setTopic: (topic: string | null) => void;

  currentTarget: Target | null;
  setCurrentTarget: (t: Target | null) => void;

  selectedObservationIds: string[];
  toggleObservation: (id: string) => void;
  selectAllObservations: (ids: string[]) => void;
  clearSelections: () => void;

  apertureRadius: number;
  innerAnnulus: number;
  outerAnnulus: number;
  setApertureRadius: (r: number) => void;
  setInnerAnnulus: (r: number) => void;
  setOuterAnnulus: (r: number) => void;

  transitFilters: TransitTargetFilters;
  setTransitFilters: (patch: Partial<TransitTargetFilters>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedTopic: null,
      setTopic: (topic) => set({ selectedTopic: topic }),

      currentTarget: null,
      setCurrentTarget: (t) =>
        set((state) => ({
          currentTarget: t,
          selectedObservationIds:
            !t || !state.currentTarget || state.currentTarget.id !== t.id
              ? []
              : state.selectedObservationIds,
        })),

      selectedObservationIds: [],
      toggleObservation: (id) =>
        set((state) => ({
          selectedObservationIds: state.selectedObservationIds.includes(id)
            ? state.selectedObservationIds.filter((x) => x !== id)
            : [...state.selectedObservationIds, id],
        })),
      selectAllObservations: (ids) => set({ selectedObservationIds: ids }),
      clearSelections: () => set({ selectedObservationIds: [] }),

      apertureRadius: 5.0,
      innerAnnulus: 10.0,
      outerAnnulus: 15.0,
      setApertureRadius: (r) => set({ apertureRadius: r }),
      setInnerAnnulus: (r) => set({ innerAnnulus: r }),
      setOuterAnnulus: (r) => set({ outerAnnulus: r }),

      transitFilters: { ...DEFAULT_TRANSIT_FILTERS },
      setTransitFilters: (patch) =>
        set((state) => ({
          transitFilters: {
            ...state.transitFilters,
            ...patch,
          },
        })),
    }),
    {
      name: 'easwa-app-state',
      version: 3,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        selectedObservationIds: state.selectedObservationIds,
        transitFilters: state.transitFilters,
      }),
      migrate: (persistedState) => {
        const state = (persistedState as Partial<AppState> | undefined) ?? {};
        return {
          ...state,
          selectedTopic: null,
          transitFilters: { ...DEFAULT_TRANSIT_FILTERS },
        } as AppState;
      },
    }
  )
);
