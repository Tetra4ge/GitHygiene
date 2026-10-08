import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';
import Logo from '../components/Logo';

export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<string | null>(null);

  const handleOAuthLogin = async (provider: 'github' | 'google') => {
    try {
      setError(null);
      setIsLoading(provider);

      // Supabase hands back whichever provider's token was just used in
      // session.provider_token, under the same generic field regardless of
      // provider — authStore reads this flag to know it's safe to treat that
      // token as a GitHub token, instead of overwriting a valid stored GitHub
      // token with a Google one whenever someone signs in with Google.
      sessionStorage.setItem('polyglot.oauth-provider', provider);

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin + '/dashboard',
          scopes: provider === 'github' ? 'repo read:org' : 'email profile'
        }
      });

      if (error) throw error;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication initiation failed.';
      console.error(`${provider} login failed:`, message);
      setError(message);
      setIsLoading(null);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-ink noise p-4">
      {/* Visual background grid + glow */}
      <div className="absolute inset-0 grid-fade pointer-events-none" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald/10 blur-[140px]" />

      <Link
        to="/"
        className="absolute left-4 top-4 sm:left-6 sm:top-6 flex items-center gap-1.5 text-[11px] font-mono text-mist transition-colors hover:text-paper"
      >
        <ArrowLeft size={13} />
        Back to home
      </Link>

      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle className="rounded-md" />
      </div>

      {/* Main Glassmorphic Card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="terminal-window relative w-full max-w-md p-8 flex flex-col items-center"
      >
        <Logo className="mb-8" withTag />

        <h2 className="text-3xl font-display font-bold text-center text-gradient mb-2">
          Open a secure session_
        </h2>
        <p className="text-sm text-mist text-center mb-8 font-mono">
          Authenticate using authorized identity providers to load your repository metrics.
        </p>

        {error && (
          <div className="w-full flex items-start gap-2 bg-danger/10 border border-danger/30 p-4 mb-6 text-danger text-xs font-mono">
            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="w-full flex flex-col gap-4">
          {/* GitHub Login Button */}
          <button
            onClick={() => handleOAuthLogin('github')}
            disabled={isLoading !== null}
            className="group w-full flex items-center justify-center gap-3 rounded-md bg-paper text-ink hover:opacity-90 active:scale-[0.98] py-3.5 transition-all duration-200 font-mono font-bold cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          >
            <svg className="w-5 h-5 transition-transform group-hover:scale-110 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.137 20.162 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
            {isLoading === 'github' ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-ink/30 border-t-ink animate-spin" />
                Connecting...
              </span>
            ) : (
              'Authorize with GitHub'
            )}
          </button>

          {/* Google Login Button */}
          <button
            onClick={() => handleOAuthLogin('google')}
            disabled={isLoading !== null}
            className="group w-full flex items-center justify-center gap-3 rounded-md bg-ink-soft border border-border hover:bg-border/60 hover:text-white text-paper active:scale-[0.98] py-3.5 transition-all duration-200 font-mono font-bold cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          >
            <svg className="w-5 h-5 transition-transform group-hover:scale-110 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114-3.555 0-6.437-2.882-6.437-6.437s2.882-6.437 6.437-6.437c1.558 0 2.978.558 4.093 1.482l3.078-3.078C19.308 2.217 15.975 1 12.24 1c-6.076 0-11 4.924-11 11s4.924 11 11 11c6.347 0 11.238-4.472 11.238-11.238 0-.497-.043-.979-.117-1.487H12.24z"/>
            </svg>
            {isLoading === 'google' ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-paper/30 border-t-paper animate-spin" />
                Connecting...
              </span>
            ) : (
              'Authorize with Google'
            )}
          </button>
        </div>

        <div className="mt-8 flex items-center gap-2 text-center text-[10px] text-mist font-mono">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald animate-pulse-soft" />
          SECURE ENCRYPTED JWT SESSION // SINGLE SIGN-ON
        </div>
      </motion.div>
    </div>
  );
}
