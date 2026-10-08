import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { useAuthStore } from './lib/authStore';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import DashboardLayout from './layouts/DashboardLayout';
import Overview from './pages/dashboard/Overview';
import Organizations from './pages/dashboard/Organizations';
import Repositories from './pages/dashboard/Repositories';
import Manifests from './pages/dashboard/Manifests';
import Scanner from './pages/dashboard/Scanner';
import Team from './pages/dashboard/Team';
import Profile from './pages/dashboard/Profile';
import { Terminal } from 'lucide-react';

// Route protection wrapper for dashboard access
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-ink noise text-emerald gap-3">
        <Terminal size={32} className="animate-pulse-soft" />
        <span className="font-mono text-xs tracking-widest">LOADING CONSOLE STATE...</span>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Redirects logged-in users away from login page
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuthStore();

  if (isLoading) {
    return null;
  }

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function App() {
  const { setSession } = useAuthStore();

  useEffect(() => {
    // 1. Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // 2. Set up listener for active transitions (login/logout/token refreshed)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setSession]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/login"
          element={
            <AuthRoute>
              <Login />
            </AuthRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Overview />} />
          <Route path="organizations" element={<Organizations />} />
          <Route path="repositories" element={<Repositories />} />
          <Route path="manifests" element={<Manifests />} />
          <Route path="scanner" element={<Scanner />} />
          <Route path="team" element={<Team />} />
          <Route path="profile" element={<Profile />} />
        </Route>
        {/* Fallback route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
