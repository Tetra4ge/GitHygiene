import { createContext, useContext, useState, type ReactNode } from 'react';
import type { GitHubRepo, Repository } from './types';

interface DashboardState {
  selectedRepo: Repository | null;
  setSelectedRepo: (repo: Repository | null) => void;
  githubRepos: GitHubRepo[];
  setGithubRepos: (repos: GitHubRepo[]) => void;
}

const DashboardContext = createContext<DashboardState | null>(null);

/**
 * Shared state for the routed dashboard pages. DashboardLayout owns this —
 * it stays mounted across every /dashboard/* navigation while its child pages
 * unmount and remount, so state that should survive "picked a repo on
 * Repositories, now on Manifests" has to live above the <Outlet/>, not inside
 * any one page.
 */
export function DashboardProvider({ children }: { children: ReactNode }) {
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);

  return (
    <DashboardContext.Provider value={{ selectedRepo, setSelectedRepo, githubRepos, setGithubRepos }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within a DashboardProvider');
  return ctx;
}
