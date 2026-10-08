import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../lib/themeStore';

/** Icon button that flips the dark/light theme token set and persists the choice. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useThemeStore();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`relative grid h-9 w-9 shrink-0 place-items-center border border-border bg-ink-soft text-mist transition-colors hover:text-paper cursor-pointer ${className}`}
    >
      <Sun
        size={15}
        className={`absolute transition-all duration-300 ${isDark ? 'scale-0 -rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'}`}
      />
      <Moon
        size={15}
        className={`absolute transition-all duration-300 ${isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-0 rotate-90 opacity-0'}`}
      />
    </button>
  );
}
