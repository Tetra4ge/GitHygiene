import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, ArrowUpRight } from 'lucide-react';
import Logo from '../Logo';
import ThemeToggle from '../ThemeToggle';
import { useAuthStore } from '../../lib/authStore';

const LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Intelligence', href: '#intelligence' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { session } = useAuthStore();
  const ctaTarget = session ? '/dashboard' : '/login';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? 'py-3' : 'py-5'
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 sm:px-8">
        <div
          className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 transition-all duration-300 sm:px-5 ${
            scrolled
              ? 'glass border-border shadow-[0_10px_40px_-15px_rgba(0,0,0,0.6)]'
              : 'border-transparent bg-transparent'
          }`}
        >
          <Logo />

          <nav className="hidden items-center gap-8 md:flex">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[13px] text-mist transition-colors hover:text-paper"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <ThemeToggle className="rounded-md" />
            <Link
              to={ctaTarget}
              className="group flex items-center gap-1.5 rounded-md bg-paper px-4 py-2 text-[13px] font-bold text-ink transition-transform hover:scale-[1.02]"
            >
              {session ? 'Console' : 'Get Started'}
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle className="rounded-md h-8 w-8" />
            <button
              aria-label="Toggle menu"
              onClick={() => setOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-md border border-border text-paper cursor-pointer"
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="mx-5 mt-2 flex flex-col gap-1 rounded-xl border border-border bg-ink-soft/95 p-4 backdrop-blur-xl sm:mx-8 md:hidden">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm text-mist hover:bg-paper/5 hover:text-paper"
            >
              {link.label}
            </a>
          ))}
          <div className="my-2 h-px bg-border" />
          <Link
            to={ctaTarget}
            onClick={() => setOpen(false)}
            className="mt-1 rounded-md bg-paper px-3 py-2.5 text-center text-sm font-bold text-ink"
          >
            {session ? 'Console' : 'Get Started'}
          </Link>
        </div>
      )}
    </header>
  );
}
