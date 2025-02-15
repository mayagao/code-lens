"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GitHubService } from "@/services/github";
import { useAppStore } from "@/store";

export default function Home() {
  const router = useRouter();
  const {
    repositoryCache,
    setRepositories,
    setRepositoryCacheLoading,
    setRepositoryCacheError,
    setCurrentRepository,
  } = useAppStore();

  useEffect(() => {
    async function fetchRepositories() {
      // Check if we have a valid cache
      const now = Date.now();
      const cacheAge = repositoryCache.lastFetched
        ? now - repositoryCache.lastFetched
        : Infinity;

      // If cache is valid and we have repositories, use them
      if (cacheAge < 5 * 60 * 1000 && repositoryCache.repositories.length > 0) {
        return;
      }

      try {
        setRepositoryCacheLoading(true);
        const githubService = GitHubService.getInstance();
        const repos = await githubService.getUserRepositories();
        setRepositories(repos);
      } catch (error) {
        console.error("Failed to fetch repositories:", error);
        setRepositoryCacheError(
          error instanceof Error
            ? error.message
            : "Failed to fetch repositories"
        );
      }
    }

    fetchRepositories();
  }, [
    repositoryCache.lastFetched,
    repositoryCache.repositories.length,
    setRepositories,
    setRepositoryCacheLoading,
    setRepositoryCacheError,
  ]);

  const handleRepositoryClick = (
    repo: (typeof repositoryCache.repositories)[0]
  ) => {
    setCurrentRepository(repo);
    router.push(`/${repo.owner}/${repo.name}`);
  };

  if (repositoryCache.error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-3xl font-bold text-red-600">Error</h1>
        <p className="text-gray-600 mb-4">{repositoryCache.error}</p>
        <p className="text-sm text-gray-500">
          Make sure you have set your GitHub token in .env.local:
          <br />
          NEXT_PUBLIC_GITHUB_TOKEN=your_github_token
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Your Repositories</h1>
      </div>

      {repositoryCache.isLoading ? (
        <div className="flex justify-center items-center min-h-[400px]">
          <div className="animate-pulse flex flex-col gap-4 w-full max-w-4xl">
            <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="border rounded-lg p-4 space-y-2">
                  <div className="h-6 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {repositoryCache.repositories.map((repo) => (
            <div
              key={repo.id}
              className="border rounded-lg p-4 hover:border-blue-500 cursor-pointer transition-colors"
              onClick={() => handleRepositoryClick(repo)}
            >
              <h2 className="text-xl font-semibold">{repo.name}</h2>
              <p className="text-gray-600 text-sm">{repo.owner}</p>
              <p className="text-gray-700 mt-2 line-clamp-2">
                {repo.description}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
