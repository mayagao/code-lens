"use client";

import { useState } from "react";
import type { Commit } from "@/services/github";
import { formatDistanceToNow } from "date-fns";

interface CommitListProps {
  commits: Commit[];
  isLoading?: boolean;
}

export function CommitList({ commits, isLoading = false }: CommitListProps) {
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="h-20 bg-gray-100 rounded-lg p-4">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {commits.map((commit) => (
        <div
          key={commit.sha}
          className="border rounded-lg hover:border-blue-200 transition-colors"
        >
          <div
            className="p-4 cursor-pointer"
            onClick={() =>
              setExpandedCommit(
                expandedCommit === commit.sha ? null : commit.sha
              )
            }
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {commit.author.avatarUrl && (
                  <img
                    src={commit.author.avatarUrl}
                    alt={commit.author.name}
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <div>
                  <h3 className="font-medium text-gray-900">
                    {commit.message.split("\n")[0]}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {commit.author.name} committed{" "}
                    {formatDistanceToNow(new Date(commit.author.date), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              </div>
              <a
                href={commit.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-500 hover:text-blue-600 font-mono"
                onClick={(e) => e.stopPropagation()}
              >
                {commit.sha.substring(0, 7)}
              </a>
            </div>

            {expandedCommit === commit.sha && commit.stats && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex gap-4 text-sm text-gray-600 mb-3">
                  <span className="text-green-600">
                    +{commit.stats.additions} additions
                  </span>
                  <span className="text-red-600">
                    -{commit.stats.deletions} deletions
                  </span>
                </div>
                {commit.files && (
                  <div className="space-y-2">
                    {commit.files.map((file) => (
                      <div
                        key={file.filename}
                        className="text-sm flex items-center gap-2"
                      >
                        <span
                          className={`w-16 text-right ${
                            file.status === "added"
                              ? "text-green-600"
                              : file.status === "removed"
                              ? "text-red-600"
                              : "text-gray-600"
                          }`}
                        >
                          {file.status === "added"
                            ? "added"
                            : file.status === "removed"
                            ? "removed"
                            : `${file.changes} changes`}
                        </span>
                        <span className="text-gray-700 font-mono text-xs truncate">
                          {file.filename}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
