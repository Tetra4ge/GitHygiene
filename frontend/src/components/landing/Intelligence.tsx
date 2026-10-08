import { motion } from 'framer-motion';
import { MessageSquare, Wand2, FileWarning, Gauge } from 'lucide-react';

const CAPABILITIES = [
  { icon: Gauge, label: 'Repository health advisor' },
  { icon: Wand2, label: 'Dependency upgrade planner' },
  { icon: FileWarning, label: 'Plain-English CVE explainer' },
  { icon: MessageSquare, label: 'Natural-language repo chat' },
];

export default function Intelligence() {
  return (
    <section id="intelligence" className="relative px-5 py-28 sm:px-8">
      <div className="terminal-window mx-auto max-w-6xl overflow-hidden">
        <div className="relative grid grid-cols-1 lg:grid-cols-2">
          <div className="pointer-events-none absolute -left-24 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-[var(--color-emerald)]/10 blur-[110px]" />

          <div className="relative p-8 sm:p-12">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-emerald)]">
              AI Intelligence
            </span>
            <h2 className="font-display mt-4 text-3xl font-medium tracking-tight text-paper sm:text-4xl">
              Ask your repository anything.
            </h2>
            <p className="mt-4 max-w-md text-[14px] leading-relaxed text-mist">
              RAG-ready chat sits directly on top of your relational and graph data —
              so "which services still depend on the vulnerable lodash version?" gets
              a real, sourced answer.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CAPABILITIES.map((c, i) => (
                <motion.div
                  key={c.label}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-paper/[0.03] px-3.5 py-3"
                >
                  <c.icon className="h-4 w-4 shrink-0 text-[var(--color-emerald)]" />
                  <span className="text-[12.5px] text-paper/70">{c.label}</span>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="relative flex items-center justify-center border-t border-border bg-paper/[0.02] p-8 sm:p-12 lg:border-l lg:border-t-0">
            <div className="w-full max-w-sm space-y-3">
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-paper/10 px-4 py-2.5 text-[13px] text-paper/85">
                Which repos have critical CVEs older than 30 days?
              </div>
              {/* AI response readout — stays dark intentionally, like a fixed
                  terminal output pane, so its literal white/[#0b0b0f] classes
                  below are not theme tokens. */}
              <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-white/10 bg-[#0b0b0f] px-4 py-3 text-[13px] leading-relaxed text-white/70">
                <span className="text-[var(--color-emerald)]">3 repositories</span> —{' '}
                <span className="font-mono text-white">api-gateway</span> and{' '}
                <span className="font-mono text-white">ai-service</span> carry a
                critical <span className="font-mono text-red-300">lodash</span> CVE
                from 34 days ago. Suggest upgrading to{' '}
                <span className="font-mono text-white">4.17.21</span> — no breaking
                changes detected in the dependency graph.
              </div>
              <div className="flex items-center gap-2 px-1 text-[11px] text-mist">
                <span className="animate-pulse-soft h-1.5 w-1.5 rounded-full bg-[var(--color-emerald)]" />
                Generated from live graph + relational data
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
