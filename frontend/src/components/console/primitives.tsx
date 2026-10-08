import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';

/** Bordered console panel with a terminal-style header strip. */
export function Panel({
  title,
  subtitle,
  icon,
  actions,
  children
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass border border-border transition-colors hover:border-border/90">
      <header className="border-b border-border/70 bg-ink-soft/40 px-5 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
        <div className="flex items-start gap-3">
          {icon && <span className="text-emerald mt-0.5 shrink-0">{icon}</span>}
          <div>
            <h2 className="font-display font-bold text-sm tracking-wide text-paper">{title}</h2>
            {subtitle && <p className="text-[10px] text-mist mt-0.5 leading-relaxed">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'default',
  disabled,
  loading,
  title
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'default' | 'primary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  title?: string;
}) {
  const variants = {
    default: 'bg-ink-soft border border-border hover:bg-border/60 hover:text-paper text-paper',
    primary: 'bg-azure border border-azure hover:bg-azure-deep text-ink',
    ghost: 'border border-transparent hover:border-border text-mist hover:text-paper'
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink ${variants[variant]}`}
    >
      {loading && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  hint,
  type = 'text'
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] text-mist tracking-widest uppercase">
        {label}
        {required && <span className="text-emerald"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="bg-ink-soft border border-border focus:border-emerald/60 focus-visible:ring-2 focus-visible:ring-emerald/20 outline-none px-3 py-2 text-xs text-paper placeholder:text-mist transition-colors"
      />
      {hint && <span className="text-[10px] text-mist">{hint}</span>}
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  required,
  hint
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] text-mist tracking-widest uppercase">
        {label}
        {required && <span className="text-emerald"> *</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-ink-soft border border-border focus:border-emerald/60 focus-visible:ring-2 focus-visible:ring-emerald/20 outline-none px-3 py-2 text-xs text-paper transition-colors cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-ink-soft">
            {opt.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-[10px] text-mist">{hint}</span>}
    </label>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'bg-danger/10 border-danger/30 text-danger',
    success: 'bg-emerald/10 border-emerald/30 text-emerald',
    info: 'bg-emerald/5 border-emerald/20 text-emerald'
  };
  const Icon = kind === 'error' ? AlertTriangle : kind === 'success' ? CheckCircle2 : Info;

  return (
    <div
      className={`flex items-start gap-2 border p-3 text-[11px] leading-relaxed animate-fade-in-down ${styles[kind]}`}
    >
      <Icon size={14} className="shrink-0 mt-0.5" />
      <span className="break-words">{children}</span>
    </div>
  );
}

/** Horizontally scrollable data table — read side of every CRUD panel. */
export function Table<T>({
  columns,
  rows,
  keyOf,
  empty
}: {
  columns: Array<{ header: string; cell: (row: T) => ReactNode; width?: string }>;
  rows: T[];
  keyOf: (row: T) => string;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-border/70 py-8 text-center text-[11px] text-mist">
        {empty}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-border/70">
      <table className="w-full text-left text-[11px]">
        <thead className="bg-ink-soft/60 text-mist">
          <tr>
            {columns.map((col) => (
              <th
                key={col.header}
                style={{ width: col.width }}
                className="px-3 py-2 font-normal tracking-widest uppercase text-[10px] whitespace-nowrap"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyOf(row)} className="border-t border-border/50 hover:bg-ink-soft/40 transition-colors">
              {columns.map((col) => (
                <td key={col.header} className="px-3 py-2.5 align-top">
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 justify-center text-[11px] text-mist">
      <Loader2 size={14} className="animate-spin text-emerald" />
      {label}
    </div>
  );
}
