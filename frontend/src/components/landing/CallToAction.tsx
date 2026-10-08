import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

export default function CallToAction() {
  return (
    <section className="relative px-5 py-28 sm:px-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="terminal-window relative mx-auto max-w-4xl overflow-hidden px-6 py-16 text-center sm:px-12"
      >
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,var(--color-emerald),transparent_70%)] opacity-20" />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-ink-soft" />

        <h2 className="font-display mx-auto max-w-2xl text-3xl font-medium tracking-tight text-paper sm:text-5xl">
          Ready to see what's really in your dependency tree?
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[14px] leading-relaxed text-mist">
          Free to start. No credit card. Connect your first repository in under two
          minutes.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/login"
            className="group flex w-full items-center justify-center gap-2 rounded-md bg-paper px-7 py-3.5 text-sm font-bold text-ink transition-transform hover:scale-[1.03] sm:w-auto"
          >
            Create account
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
