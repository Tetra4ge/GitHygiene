import { motion } from 'framer-motion';
import {
  ShieldCheck,
  Share2,
  BrainCircuit,
  GitFork,
  LineChart,
  BellRing,
} from 'lucide-react';

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Dependency Security Scanner',
    desc: 'Every package resolved against live CVE data. Outdated, deprecated, and license-risky dependencies surfaced before they ship.',
    span: 'lg:col-span-2',
  },
  {
    icon: Share2,
    title: 'Neo4j Dependency Graph',
    desc: 'Repository → Package → Dependency → CVE, modeled as a real knowledge graph. Trace vulnerable paths and shared dependencies visually.',
    span: '',
  },
  {
    icon: BrainCircuit,
    title: 'AI Intelligence Service',
    desc: 'Health advisor, upgrade planner, CVE explainer, and a repo-aware chat that answers questions in plain English.',
    span: '',
  },
  {
    icon: GitFork,
    title: 'GitHub Integration',
    desc: 'Connect once. Branches, commits, contributors, releases, and manifests stay synced automatically.',
    span: '',
  },
  {
    icon: LineChart,
    title: 'Repository Analytics',
    desc: 'Health trends, vulnerability trajectories, and package growth — rolled up per project or across the whole org.',
    span: 'lg:col-span-2',
  },
  {
    icon: BellRing,
    title: 'Notifications',
    desc: 'Critical CVEs, failed syncs, and weekly security digests — delivered to your dashboard and inbox the moment they matter.',
    span: '',
  },
];

export default function Features() {
  return (
    <section id="features" className="relative px-5 py-28 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-emerald)]">
            Platform
          </span>
          <h2 className="font-display mt-4 text-3xl font-medium tracking-tight text-paper sm:text-5xl">
            One surface for repository intelligence
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-mist">
            Six modules, one relational and graph-backed core. Nothing duplicated,
            nothing disconnected.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.08 }}
              className={`group relative overflow-hidden rounded-lg border border-border bg-paper/[0.025] p-6 transition-colors hover:border-emerald/40 hover:bg-paper/[0.045] ${f.span}`}
            >
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[var(--color-emerald)]/0 blur-3xl transition-all duration-500 group-hover:bg-[var(--color-emerald)]/15" />
              <div className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-paper/5">
                <f.icon className="h-4.5 w-4.5 text-[var(--color-emerald)]" />
              </div>
              <h3 className="font-display relative mt-5 text-lg font-medium text-paper">
                {f.title}
              </h3>
              <p className="relative mt-2 text-[13.5px] leading-relaxed text-mist">
                {f.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
