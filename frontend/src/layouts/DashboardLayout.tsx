import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Bell,
  Building2,
  FileCode2,
  GitBranch,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  ScanSearch,
  ShieldAlert,
  UserCog,
  Users
} from 'lucide-react';
import { useAuthStore } from '../lib/authStore';
import { apiError, notificationsApi, usersApi } from '../lib/api';
import type { Notification, Role } from '../lib/types';
import { Alert } from '../components/console/primitives';
import ThemeToggle from '../components/ThemeToggle';
import Logo from '../components/Logo';
import { DashboardProvider } from '../lib/dashboardContext';

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  /** Omit to show for every role. */
  roles?: Role[];
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/dashboard/organizations', label: 'Organizations', icon: Building2, roles: ['admin', 'manager'] },
      { to: '/dashboard/repositories', label: 'Repositories', icon: GitBranch },
      { to: '/dashboard/manifests', label: 'Manifests', icon: FileCode2 },
      { to: '/dashboard/security', label: 'Security', icon: ShieldAlert },
      { to: '/dashboard/scanner', label: 'Legacy Scanner', icon: ScanSearch }
    ]
  },
  {
    label: 'Account',
    items: [
      { to: '/dashboard/team', label: 'Team', icon: Users, roles: ['admin', 'manager'] },
      { to: '/dashboard/profile', label: 'Profile', icon: UserCog }
    ]
  }
];

const SIDEBAR_KEY = 'githygiene.sidebar-open';

/**
 * Shared chrome for every /dashboard/* route: a slim top bar, a collapsible
 * role-filtered sidebar, and the shared repo-selection context. Individual
 * pages render into <Outlet/>.
 */
export default function DashboardLayout() {
  const { profile, setProfile, logout } = useAuthStore();
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true');
  const location = useLocation();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  // Poll every 30s while the tab is visible (phases/Phase_09.md §6).
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      notificationsApi
        .list()
        .then(({ notifications, unreadCount }) => {
          if (!cancelled) {
            setNotifications(notifications);
            setUnreadCount(unreadCount);
          }
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleOpenNotification = async (n: Notification) => {
    if (!n.is_read) {
      try {
        await notificationsApi.markRead(n.notification_id);
        setNotifications((prev) => prev.map((x) => (x.notification_id === n.notification_id ? { ...x, is_read: true } : x)));
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // non-critical — leave it unread rather than block the UI
      }
    }
  };

  // The Postgres profile drives role-gating across every page, so load it once here.
  useEffect(() => {
    usersApi
      .me()
      .then(setProfile)
      .catch((err) => setProfileError(apiError(err)));
  }, [setProfile]);

  // Collapse the sidebar automatically after a navigation on mobile — it's an
  // overlay there, so leaving it open would sit on top of the new page.
  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, [location.pathname]);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  };

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || (profile?.role && item.roles.includes(profile.role)))
  })).filter((group) => group.items.length > 0);

  return (
    <DashboardProvider>
      <div className="relative min-h-screen bg-ink noise text-paper flex flex-col font-mono">
        <header className="border-b border-border/80 bg-ink-soft/80 backdrop-blur-md py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Fixed to the collapsed sidebar's width (w-14) and centered the same
                way the nav icons below are, so the toggle sits directly above them
                instead of drifting with the header's own left padding. */}
            <div className="w-14 shrink-0 flex justify-center">
              <button
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                aria-expanded={sidebarOpen}
                title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                className="grid h-9 w-9 shrink-0 place-items-center bg-ink-soft border border-border hover:bg-border/60 hover:text-paper transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                <PanelLeft size={15} />
              </button>
            </div>

            <Logo className="min-w-0" />
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0 pr-4 sm:pr-6">
            <div className="relative">
              <button
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="Notifications"
                title="Notifications"
                className="relative grid h-9 w-9 place-items-center bg-ink-soft border border-border hover:bg-border/60 hover:text-paper transition-all cursor-pointer"
              >
                <Bell size={15} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-danger text-[9px] font-bold text-white rounded-full h-4 min-w-4 px-1 grid place-items-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-ink-soft border border-border z-50 shadow-xl">
                  {notifications.length === 0 ? (
                    <p className="p-4 text-[11px] text-mist">No notifications yet.</p>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.notification_id}
                        onClick={() => void handleOpenNotification(n)}
                        className={`w-full text-left px-3 py-2.5 border-b border-border/40 last:border-b-0 hover:bg-border/30 transition-all ${
                          n.is_read ? 'opacity-60' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-emerald shrink-0" />}
                          <span className="text-[11px] font-bold text-paper truncate">{n.title}</span>
                        </div>
                        {n.body && <p className="text-[10px] text-mist mt-1 leading-relaxed">{n.body}</p>}
                        <span className="text-[9px] text-mist/70 block mt-1">
                          {new Date(n.created_at).toLocaleString()}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <ThemeToggle />
            <button
              onClick={() => logout()}
              aria-label="Logout"
              title="Logout"
              className="grid h-9 w-9 place-items-center bg-ink-soft border border-border hover:bg-border/60 hover:text-paper transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        <div className="flex-1 flex relative">
          {/* Backdrop — mobile only, closes the sidebar when tapped outside it */}
          {sidebarOpen && (
            <div
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
              aria-hidden="true"
            />
          )}

          <nav
            className={`shrink-0 border-r border-border/80 bg-ink-soft/40 md:bg-ink-soft/20 flex flex-col overflow-x-hidden transition-[width] duration-200 ease-out will-change-[width] contain-layout fixed md:static top-[65px] bottom-0 z-40 ${
              sidebarOpen ? 'w-56' : 'w-0 md:w-14'
            }`}
          >
            <div className={`flex-1 overflow-y-auto overflow-x-hidden py-3 ${sidebarOpen ? 'px-3' : 'px-0 md:px-2'}`}>
              {visibleGroups.map((group, i) => (
                <div key={group.label} className={i > 0 ? 'mt-4' : ''}>
                  {sidebarOpen && (
                    <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-mist/60">
                      {group.label}
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    {group.items.map(({ to, label, icon: Icon, end }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end={end}
                        title={label}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold whitespace-nowrap transition-all cursor-pointer border-l-2 focus-visible:outline-none focus-visible:bg-ink-soft/60 ${
                            sidebarOpen ? '' : 'md:justify-center md:px-0'
                          } ${
                            isActive
                              ? 'border-emerald text-paper bg-emerald/10'
                              : 'border-transparent text-mist hover:text-paper hover:border-border'
                          }`
                        }
                      >
                        <Icon size={14} className="shrink-0" />
                        <span className={sidebarOpen ? 'inline' : 'hidden'}>{label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Session footer — status dot reflects the profile-load call above,
                so it tells the truth about the api-gateway connection instead of
                being decorative. Pinned below the scrollable nav list. */}
            <div className={`shrink-0 border-t border-border/70 ${sidebarOpen ? 'p-3' : 'p-2 flex justify-center'}`}>
              {sidebarOpen ? (
                <div className="flex flex-col gap-2 text-[11px]">
                  <div className="flex items-center gap-2 text-mist">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        profileError ? 'bg-danger' : 'bg-emerald animate-pulse-soft'
                      }`}
                    />
                    {profileError ? 'Gateway unreachable' : 'Gateway connected'}
                  </div>
                  {profile && (
                    <div className="border border-border bg-ink-soft/60 px-2.5 py-2 flex flex-col gap-0.5">
                      <span className="text-paper font-bold truncate">
                        {profile.full_name || profile.email}
                      </span>
                      <span className="text-mist/80 truncate">
                        {profile.organization_name || 'No organization'}
                      </span>
                      <span className="mt-1 inline-block w-fit border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-emerald">
                        {profile.role}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <span
                  title={profileError ? 'Gateway unreachable' : 'Gateway connected'}
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    profileError ? 'bg-danger' : 'bg-emerald animate-pulse-soft'
                  }`}
                />
              )}
            </div>
          </nav>

          <main className="flex-1 min-w-0 w-full px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6">
            {profileError && (
              <Alert kind="error">
                Could not load your profile from the gateway: {profileError}. Role-gated actions stay
                disabled until this succeeds — check that the api-gateway is running and that your user
                row exists in Postgres.
              </Alert>
            )}

            <div key={location.pathname} className="animate-fade-in flex flex-col gap-6 w-full">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </DashboardProvider>
  );
}
