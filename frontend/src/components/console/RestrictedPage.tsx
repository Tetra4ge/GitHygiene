import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Shown when a role-gated page is reached directly (e.g. a bookmarked URL) by a role that can't use it. */
export default function RestrictedPage({ page }: { page: string }) {
  return (
    <div className="glass border border-border p-8 flex flex-col items-center text-center gap-3">
      <ShieldAlert size={22} className="text-mist" />
      <h2 className="font-display font-bold text-sm text-paper">Restricted to admins and managers</h2>
      <p className="text-[11px] text-mist max-w-sm leading-relaxed">
        {page} isn't available for your role. Ask an admin or manager if you need access.
      </p>
      <Link
        to="/dashboard"
        className="mt-2 bg-ink-soft border border-border hover:bg-border/60 hover:text-paper px-3.5 py-2 text-xs font-bold transition-all"
      >
        Back to Overview
      </Link>
    </div>
  );
}
