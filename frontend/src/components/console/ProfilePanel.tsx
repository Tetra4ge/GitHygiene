import { useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { apiError, usersApi } from '../../lib/api';
import { useAuthStore } from '../../lib/authStore';
import { Button, Panel } from './primitives';

export default function ProfilePanel() {
  const { profile, setProfile } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `profile` in the store is only fetched once, on layout mount — it doesn't
  // pick up role changes made by an admin/manager (to you or anyone else) on
  // their own, so give this page a manual-reload affordance.
  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const fresh = await usersApi.me();
      setProfile(fresh);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Panel
      title="Your profile"
      subtitle="READ via GET /api/v1/users/me"
      icon={<ShieldCheck size={18} />}
      actions={
        <Button variant="ghost" onClick={handleRefresh} loading={refreshing} title="Refresh profile">
          <RefreshCw size={13} />
        </Button>
      }
    >
      {error && <p className="text-[11px] text-danger mb-3">{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
        <Detail label="FULL NAME" value={profile?.full_name || '—'} />
        <Detail label="EMAIL" value={profile?.email || '—'} />
        <Detail label="ROLE" value={profile?.role || '—'} accent />
        <Detail label="ORGANIZATION" value={profile?.organization_name || 'Unassigned'} />
        <Detail label="USER ID" value={profile?.user_id || '—'} mono />
        <Detail label="ORGANIZATION ID" value={profile?.organization_id || '—'} mono />
      </div>
    </Panel>
  );
}

function Detail({
  label,
  value,
  accent,
  mono
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="bg-ink-soft/50 border border-border/60 p-3">
      <span className="text-[10px] text-mist block mb-1">{label}</span>
      <span
        className={`font-bold break-all select-all ${
          accent ? 'text-emerald uppercase' : mono ? 'text-mist text-[10px]' : 'text-paper'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
