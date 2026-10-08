import Logo from '../Logo';

export default function Footer() {
  return (
    <footer className="relative border-t border-border px-5 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <Logo />
          <p className="text-[12px] text-mist">
            Repository intelligence, unified.
          </p>
        </div>


        <p className="text-[12px] text-mist">
          &copy; {new Date().getFullYear()} GitHygiene. Built by Team <a href="https://github.com/tetra4ge" target="_blank" rel="noopener noreferrer" className="hover:text-paper transition-colors underline decoration-border underline-offset-4">TetraFourge</a>.
        </p>
      </div>
    </footer>
  );
}
