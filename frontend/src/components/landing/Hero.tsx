import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ShieldCheck, GitBranch } from 'lucide-react';

const STATS = [
  { label: 'CVEs cross-referenced', value: '40K+' },
  { label: 'Dependency graph engine', value: 'Neo4j' },
  { label: 'Repo sync latency', value: '<2s' },
  { label: 'AI insight coverage', value: '24/7' },
];

export default function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pb-28 pt-40 sm:px-8 sm:pt-48">
      {/* backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-14rem] h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-[var(--color-emerald)]/10 blur-[150px]" />
        <div className="grid-fade absolute inset-x-0 top-0 h-[42rem]" />
      </div>

      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="terminal-prompt mx-auto flex w-fit items-center gap-2 rounded-md border border-border bg-paper/[0.035] px-4 py-1.5 text-[10px] uppercase tracking-[0.14em] text-mist"
        >

          AI-Powered Repository Intelligence
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08, ease: 'easeOut' }}
          className="font-display mx-auto mt-7 max-w-4xl text-center text-[2.75rem] font-medium leading-[1.06] tracking-tight text-paper sm:text-6xl md:text-[4.5rem]"
        >
          Know exactly what's
          <br />
          <span className="text-gradient">running in your stack_</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.16, ease: 'easeOut' }}
          className="mx-auto mt-6 max-w-xl text-center text-[15px] leading-relaxed text-mist"
        >
          GitHygiene unifies GitHub repository scanning, dependency security, and a live Neo4j
          knowledge graph into one AI-driven command center - so every repo, package,
          and CVE stays visible before it becomes a problem.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.24, ease: 'easeOut' }}
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Link
            to="/login"
            className="group flex w-full items-center justify-center gap-2 rounded-md bg-paper px-6 py-3.5 text-sm font-bold text-ink transition-transform hover:scale-[1.03] sm:w-auto"
          >
            Start free
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
          <a
            href="#how-it-works"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-6 py-3.5 text-sm font-bold text-mist transition-colors hover:border-paper/30 hover:text-paper sm:w-auto"
          >
            See how it works
          </a>
        </motion.div>

        {/* mock product panel */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.32, ease: 'easeOut' }}
          className="relative mx-auto mt-20 max-w-4xl"
        >
          {/* Product screenshot mockup — follows the site theme (dark/light)
              via token classes, like the rest of the page. */}
          <div className="terminal-window noise relative overflow-hidden">
              <div className="terminal-bar">
                <span className="terminal-dot red" />
                <span className="terminal-dot yellow" />
                <span className="terminal-dot green" />
                <span className="terminal-title">githygiene — security overview</span>
              </div>

              <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
                <div className="rounded-xl border border-border bg-paper/[0.03] p-4">
                  <div className="flex items-center gap-2 text-[11px] text-mist">
                    <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-emerald)]" />
                    Repo Health Score
                  </div>
                  <div className="font-display mt-3 text-3xl text-paper">92<span className="text-lg text-mist">/100</span></div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-paper/10">
                    <div className="h-full w-[92%] rounded-full bg-gradient-to-r from-[var(--color-azure)] to-[var(--color-emerald)]" />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-paper/[0.03] p-4">
                  <div className="flex items-center gap-2 text-[11px] text-mist">
                    <GitBranch className="h-3.5 w-3.5 text-[var(--color-azure)]" />
                    Dependency Graph
                  </div>
                  <div className="mt-3 flex h-14 items-end gap-1.5">
                    {[40, 65, 30, 80, 55, 90, 45].map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-sm bg-gradient-to-t from-[var(--color-azure-deep)]/70 to-[var(--color-emerald)]/70"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-mist">3 circular paths flagged</p>
                </div>

                <div className="rounded-xl border border-border bg-paper/[0.03] p-4">
                  <div className="flex items-center justify-between text-[11px] text-mist">
                    <span>Live Alerts</span>
                    <span className="animate-pulse-soft h-1.5 w-1.5 rounded-full bg-danger" />
                  </div>
                  <div className="mt-3 space-y-2 text-[11px]">
                    <div className="flex items-center justify-between rounded-lg bg-danger/10 px-2.5 py-1.5 text-danger">
                      <span>CVE-2024-91 · lodash</span>
                      <span>Critical</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-warning/10 px-2.5 py-1.5 text-warning">
                      <span>axios outdated</span>
                      <span>Medium</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-paper/5 px-2.5 py-1.5 text-mist">
                      <span>AI report ready</span>
                      <span>New</span>
                    </div>
                  </div>
                </div>
              </div>
          </div>
        </motion.div>

        {/* stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4"
        >
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-display text-2xl text-paper sm:text-3xl">{s.value}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-mist">
                {s.label}
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
