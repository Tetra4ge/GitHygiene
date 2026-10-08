import { useCallback, useState } from 'react';
import { Building2, Plus, RefreshCw } from 'lucide-react';
import { apiError, orgsApi } from '../../lib/api';
import { useAuthStore } from '../../lib/authStore';
import { useResource } from '../../lib/useResource';
import type { Organization } from '../../lib/types';
import { Alert, Button, Field, Panel, Select, Spinner, Table } from './primitives';

// Module-level constant so the hook's initial value stays referentially stable.
const EMPTY_ORGS: Organization[] = [];

export default function OrgsPanel() {
  const profile = useAuthStore((s) => s.profile);
  const {
    data: orgs,
    setData: setOrgs,
    loading,
    error,
    setError,
    reload
  } = useResource(useCallback(() => orgsApi.list(), []), EMPTY_ORGS);
  const [notice, setNotice] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [domain, setDomain] = useState('');
  const [plan, setPlan] = useState('free');

  // POST /orgs is gated behind requireRole(['admin','manager']) — mirror that here so
  // the user sees why the control is unavailable instead of hitting a 403.
  const canCreate = profile?.role === 'admin' || profile?.role === 'manager';
  const isAdmin = profile?.role === 'admin';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await orgsApi.create({
        org_name: orgName,
        domain: domain || undefined,
        subscription_plan: plan
      });
      setOrgs((prev) => [created, ...prev]);
      setNotice(`Organization "${created.organization_name}" created.`);
      setOrgName('');
      setDomain('');
      setPlan('free');
      setShowForm(false);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title={isAdmin ? 'All organizations' : 'Your organization'}
      subtitle={
        isAdmin
          ? 'CREATE + READ via /api/v1/orgs — platform-wide, every organization'
          : 'CREATE + READ via /api/v1/orgs — scoped to your organization'
      }
      icon={<Building2 size={18} />}
      actions={
        <>
          <Button variant="ghost" onClick={reload} title="Refresh list">
            <RefreshCw size={13} />
          </Button>
          <Button
            variant="primary"
            onClick={() => setShowForm((v) => !v)}
            disabled={!canCreate}
            title={canCreate ? 'New organization' : 'Requires admin or manager role'}
          >
            <Plus size={13} />
            New
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        {!canCreate && (
          <Alert kind="info">
            Your role is <strong>{profile?.role ?? 'unknown'}</strong>. Creating organizations
            requires <strong>admin</strong> or <strong>manager</strong>.
          </Alert>
        )}

        {showForm && canCreate && (
          <form
            onSubmit={handleCreate}
            className="border border-border/70 bg-ink-soft/30 p-4 flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field
                label="Organization name"
                value={orgName}
                onChange={setOrgName}
                placeholder="Acme Engineering"
                required
              />
              <Field
                label="Domain"
                value={domain}
                onChange={setDomain}
                placeholder="acme.dev"
                hint="Must be unique across organizations."
              />
              <Select
                label="Subscription plan"
                value={plan}
                onChange={setPlan}
                options={[
                  { value: 'free', label: 'free' },
                  { value: 'pro', label: 'pro' },
                  { value: 'enterprise', label: 'enterprise' }
                ]}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={saving}>
                Create organization
              </Button>
              <Button onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        )}

        {loading ? (
          <Spinner label="LOADING ORGANIZATIONS..." />
        ) : (
          <Table
            rows={orgs}
            keyOf={(o) => o.organization_id}
            empty="No organizations yet."
            columns={[
              {
                header: 'Name',
                cell: (o) => <span className="text-paper font-bold">{o.organization_name}</span>
              },
              { header: 'Domain', cell: (o) => <span className="text-mist">{o.domain || '—'}</span> },
              {
                header: 'Plan',
                cell: (o) => <span className="text-emerald uppercase">{o.subscription_plan}</span>
              },
              {
                header: 'Organization ID',
                cell: (o) => (
                  <code className="text-[10px] text-mist select-all break-all">
                    {o.organization_id}
                  </code>
                )
              },
              {
                header: 'Created',
                cell: (o) => (
                  <span className="text-mist whitespace-nowrap">
                    {new Date(o.created_at).toLocaleDateString()}
                  </span>
                )
              }
            ]}
          />
        )}

        <p className="text-[10px] text-mist leading-relaxed">
          Update and delete are not exposed by the gateway yet — org.routes.js registers only POST
          and GET.
        </p>
      </div>
    </Panel>
  );
}
