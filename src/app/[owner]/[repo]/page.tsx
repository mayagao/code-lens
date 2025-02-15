"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { GitHubService } from "@/services/github";
import { AnalysisService } from "@/services/analysis";
import { useAppStore } from "@/store";
import type { Commit } from "@/services/github";
import { CommitList } from "@/components/CommitList";

interface RepoPageParams {
  owner: string;
  repo: string;
  [key: string]: string | string[];
}

export default function RepositoryPage() {
  const params = useParams<RepoPageParams>();
  const { owner, repo } = params;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);

  const currentRepository = useAppStore((state) => state.currentRepository);

  useEffect(() => {
    async function fetchRepositoryData() {
      if (!owner || !repo) return;

      try {
        setLoading(true);
        setIsLoadingCommits(true);
        const analysisService = AnalysisService.getInstance();

        // Only fetch commits for now
        try {
          const recentCommits = await analysisService.getRecentCommits(
            owner,
            repo
          );
          setCommits(recentCommits);
        } catch (err) {
          console.error("Failed to fetch commits:", err);
          setError("Failed to fetch commits");
        } finally {
          setIsLoadingCommits(false);
        }

        setError(null);
      } catch (err) {
        console.error("Failed to fetch repository data:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch repository data"
        );
      } finally {
        setLoading(false);
      }
    }

    fetchRepositoryData();
  }, [owner, repo]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-pulse flex flex-col gap-4 w-full max-w-4xl">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-8">
        {/* Repository Header */}
        <header className="border-b pb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold mb-2">
                {owner}/{repo}
              </h1>
              {currentRepository?.description && (
                <p className="text-gray-600">{currentRepository.description}</p>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="space-y-8">
          {/* Analysis Section - Temporarily Disabled */}
          <section className="border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Repository Analysis</h2>
            <div className="text-gray-600">
              <p>
                Repository analysis is temporarily disabled while we improve the
                feature.
              </p>
              <p className="mt-2 text-sm text-gray-500">
                Check back soon for detailed repository insights and
                architecture diagrams.
              </p>
            </div>
          </section>

          {/* Commits Section */}
          <section className="border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Recent Commits</h2>
            <CommitList commits={commits} isLoading={isLoadingCommits} />
          </section>
        </div>
      </div>
    </div>
  );
}
