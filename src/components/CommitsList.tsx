"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import Image from "next/image";

interface Commit {
  sha: string;
  message: string;
  author: {
    name: string;
    avatar_url: string;
  };
  committed_date: string;
}

interface CommitsListProps {
  commits: Commit[];
}

export default function CommitsList({ commits }: CommitsListProps) {
  const params = useParams();
  const { owner, repo } = params;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Recent Commits</h2>
      </div>
      <div className="divide-y divide-gray-200">
        {commits.map((commit) => (
          <Link
            key={commit.sha}
            href={`/${owner}/${repo}/commits/${commit.sha}`}
            className="block hover:bg-gray-50 transition-colors"
          >
            <div className="px-6 py-4">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <Image
                    src={commit.author.avatar_url}
                    alt={commit.author.name}
                    width={40}
                    height={40}
                    className="rounded-full"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {commit.message}
                  </p>
                  <div className="mt-1 flex items-center space-x-2 text-sm text-gray-500">
                    <span>{commit.author.name}</span>
                    <span>•</span>
                    <span>
                      {new Date(commit.committed_date).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "numeric",
                        }
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0 self-center">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-mono text-gray-500">
                      {commit.sha.substring(0, 7)}
                    </span>
                    <svg
                      className="h-5 w-5 text-gray-400"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
