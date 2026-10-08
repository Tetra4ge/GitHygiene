import { motion } from 'framer-motion';

const STEPS = [
  {
    n: '01',
    title: 'Connect GitHub',
    desc: 'Sign in with Supabase auth, link GitHub, and import the repositories you want monitored.',
  },
  {
    n: '02',
    title: 'Scan & extract',
    desc: 'Manifest files (package.json, requirements.txt, and more) are pulled into Supabase Storage and scanned for CVEs, outdated and deprecated packages.',
  },
  {
    n: '03',
    title: 'Graph & analyze',
    desc: 'Dependencies are mapped into a Neo4j knowledge graph while the AI service scores repo health and drafts upgrade plans.',
  },
  {
    n: '04',
    title: 'Monitor & act',
    desc: 'Risk scores, trends, and alerts land on your dashboard — and in your inbox — the moment something changes.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="relative px-5 py-28 sm:px-8">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-px bg-gradient-to-r from-transparent via-paper/10 to-transparent" />
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-emerald)]">
            Workflow
          </span>
          <h2 className="font-display mt-4 text-3xl font-medium tracking-tight text-paper sm:text-5xl">
            From repo to insight in four steps
          </h2>
        </div>

        <div className="relative mt-16 overflow-hidden rounded-2xl border border-border shadow-sm">
          <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">

          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="relative flex h-full flex-col bg-ink-soft p-8 transition-colors hover:bg-paper/[0.04]"
            >
              <div className="font-display relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-ink-soft text-sm text-paper/70">
                {s.n}
              </div>
              <h3 className="font-display mt-5 text-lg font-medium text-paper">
                {s.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-mist">{s.desc}</p>
            </motion.div>
          ))}
          </div>
        </div>
      </div>
    </section>
  );
}
