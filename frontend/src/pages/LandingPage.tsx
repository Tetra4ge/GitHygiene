import { useLenis } from '../lib/useLenis';
import Navbar from '../components/landing/Navbar';
import Hero from '../components/landing/Hero';
import Features from '../components/landing/Features';
import HowItWorks from '../components/landing/HowItWorks';
import Intelligence from '../components/landing/Intelligence';
import CallToAction from '../components/landing/CallToAction';
import Footer from '../components/landing/Footer';

export default function LandingPage() {
  useLenis();

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-ink text-paper">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Intelligence />
        <CallToAction />
      </main>
      <Footer />
    </div>
  );
}
