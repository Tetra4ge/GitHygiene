import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { githubToken } from './api';
import type { UserProfile } from './types';

interface AuthState {
  session: Session | null;
  user: User | null;
  /** Postgres-side profile from GET /users/me — carries role and organization_id. */
  profile: UserProfile | null;
  isLoading: boolean;
  setSession: (session: Session | null) => void;
  setProfile: (profile: UserProfile | null) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  profile: null,
  isLoading: true,
  setSession: (session) => {
    // provider_token is only present on the initial OAuth redirect, not on later
    // token refreshes — persist it so GitHub-backed calls survive a page reload.
    // It holds whichever provider was just used, though — signing in with Google
    // would otherwise clobber a previously-stored, still-valid GitHub token with
    // a Google one. Only trust it as a GitHub token when Login.tsx's pre-redirect
    // flag confirms this OAuth round trip was actually the GitHub button.
    if (session?.provider_token && sessionStorage.getItem('githygiene.oauth-provider') === 'github') {
      githubToken.set(session.provider_token);
    }
    sessionStorage.removeItem('githygiene.oauth-provider');
    set({
      session,
      user: session?.user || null,
      isLoading: false,
      ...(session ? {} : { profile: null })
    });
  },
  setProfile: (profile) => set({ profile }),
  logout: async () => {
    const { supabase } = await import('./supabase');
    await supabase.auth.signOut();
    githubToken.clear();
    set({ session: null, user: null, profile: null, isLoading: false });
  }
}));
