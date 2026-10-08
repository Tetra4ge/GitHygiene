import { Link } from 'react-router-dom';

export default function Logo({
  className = '',
  withTag = false,
}: {
  className?: string;
  withTag?: boolean;
}) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${className}`}>
      <img src="/favicon.svg" alt="" className="h-7 w-7 shrink-0" />
      <span className="flex flex-col leading-none min-w-0">
        <span className="font-logo text-lg tracking-tight text-paper truncate">
          Poly<span className="text-gradient">glot</span>
        </span>
        {withTag && (
          <span className="mt-1 text-[10px] font-semibold tracking-[0.2em] text-mist uppercase truncate">
            Devops Platform
          </span>
        )}
      </span>
    </Link>
  );
}
