import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User, Repository, LearnedConcept } from "@/types";

interface RepositoryAnalysis {
  mermaidDiagram: string | null;
  concepts: Array<{
    name: string;
    description: string;
    category: string;
    confidence: number;
  }>;
  lastAnalyzedCommit: string | null;
  isLoading: boolean;
  error: string | null;
}

interface RepositoryCache {
  repositories: Repository[];
  lastFetched: number | null;
  isLoading: boolean;
  error: string | null;
}

interface AppState {
  user: User | null;
  currentRepository: Repository | null;
  repositoryAnalysis: RepositoryAnalysis;
  repositoryCache: RepositoryCache;
  learnedConcepts: LearnedConcept[];
  isAnalyzing: boolean;

  // Actions
  setUser: (user: User | null) => void;
  setCurrentRepository: (repo: Repository | null) => void;
  setRepositoryAnalysis: (analysis: Partial<RepositoryAnalysis>) => void;
  setRepositories: (repositories: Repository[]) => void;
  setRepositoryCacheLoading: (isLoading: boolean) => void;
  setRepositoryCacheError: (error: string | null) => void;
  addLearnedConcept: (concept: LearnedConcept) => void;
  setAnalyzing: (analyzing: boolean) => void;
  updateProgress: (progress: number) => void;
  clearRepositoryCache: () => void;
}

const initialAnalysisState: RepositoryAnalysis = {
  mermaidDiagram: null,
  concepts: [],
  lastAnalyzedCommit: null,
  isLoading: false,
  error: null,
};

const initialRepositoryCacheState: RepositoryCache = {
  repositories: [],
  lastFetched: null,
  isLoading: false,
  error: null,
};

// Cache duration in milliseconds (e.g., 5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      currentRepository: null,
      repositoryAnalysis: initialAnalysisState,
      repositoryCache: initialRepositoryCacheState,
      learnedConcepts: [],
      isAnalyzing: false,

      setUser: (user) => set({ user }),
      setCurrentRepository: (repo) =>
        set({
          currentRepository: repo,
          repositoryAnalysis: initialAnalysisState,
        }),
      setRepositoryAnalysis: (analysis) =>
        set((state) => ({
          repositoryAnalysis: {
            ...state.repositoryAnalysis,
            ...analysis,
          },
        })),
      setRepositories: (repositories) =>
        set((state) => ({
          repositoryCache: {
            ...state.repositoryCache,
            repositories,
            lastFetched: Date.now(),
            isLoading: false,
            error: null,
          },
        })),
      setRepositoryCacheLoading: (isLoading) =>
        set((state) => ({
          repositoryCache: {
            ...state.repositoryCache,
            isLoading,
          },
        })),
      setRepositoryCacheError: (error) =>
        set((state) => ({
          repositoryCache: {
            ...state.repositoryCache,
            error,
            isLoading: false,
          },
        })),
      clearRepositoryCache: () =>
        set((state) => ({
          repositoryCache: initialRepositoryCacheState,
        })),
      addLearnedConcept: (concept) =>
        set((state) => ({
          learnedConcepts: [...state.learnedConcepts, concept],
          user: state.user
            ? {
                ...state.user,
                learnedConcepts: [...state.user.learnedConcepts, concept],
              }
            : null,
        })),
      setAnalyzing: (analyzing) => set({ isAnalyzing: analyzing }),
      updateProgress: (progress) =>
        set((state) => ({
          user: state.user ? { ...state.user, progress } : null,
        })),
    }),
    {
      name: "codeteach-storage",
    }
  )
);
