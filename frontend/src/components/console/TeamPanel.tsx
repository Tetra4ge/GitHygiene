import { useCallback, useState } from 'react';
import { PencilLine, RefreshCw, UserCog, Users } from 'lucide-react';
import { apiError, usersApi } from '../../lib/api';
import { useAuthStore } from '../../lib/authStore';
import { useResource } from '../../lib/useResource';
import type { OrgMember, Role } from '../../lib/types';
import { Alert, Button, Field, Panel, Select, Spinner, Table } from './primitives';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'developer', label: 'developer' },
  { value: 'manager', label: 'manager' },
  { value: 'admin', label: 'admin' }
];

// Module-level constant so the hook's initial value stays referentially stable.
const EMPTY_MEMBERS: OrgMember[] = [];

/**
 * Team roster + role editor — admin/manager only page (GET /users and
 * PUT /users/:id/role are both gated to those roles server-side). Admins see
 * every organization's roster; managers see only their own.
 */
export default function TeamPanel() {
  const { profile, setProfile } = useAuthStore();
  const isAdmin = profile?.role === 'admin';

  const [targetUserId, setTargetUserId] = useState('');
  const [role, setRole] = useState<Role>('developer');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    data: members,
    loading: membersLoading,
    error: membersError,
    reload: reloadMembers
  } = useResource(useCallback(() => usersApi.listOrgMembers(), []), EMPTY_MEMBERS);

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await usersApi.updateRole(targetUserId, role);
      setNotice(`Role for ${updated.email || updated.user_id} set to ${updated.role}.`);
      // Refresh our own cached profile if we just changed our own role.
      if (profile && updated.user_id === profile.user_id) {
        setProfile({ ...profile, role: updated.role });
      }
      setTargetUserId('');
      reloadMembers();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handlePickMember = (member: OrgMember) => {
    setTargetUserId(member.user_id);
    setRole(member.role);
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title={isAdmin ? 'Team — every organization' : 'Team — your organization'}
        subtitle={
          isAdmin
            ? 'READ via GET /api/v1/users — platform-wide roster'
            : 'READ via GET /api/v1/users — scoped to your organization'
        }
        icon={<Users size={18} />}
        actions={
          <Button variant="ghost" onClick={reloadMembers} title="Refresh member list">
            <RefreshCw size={13} />
          </Button>
        }
      >
        {membersError && <Alert kind="error">{membersError}</Alert>}
        {membersLoading ? (
          <Spinner label="LOADING MEMBERS..." />
        ) : (
          <Table
            rows={members}
            keyOf={(m) => m.user_id}
            empty="No other members yet."
            columns={[
              { header: 'Name', cell: (m) => <span className="text-paper font-bold">{m.full_name || '—'}</span> },
              { header: 'Email', cell: (m) => <span className="text-mist">{m.email}</span> },
              ...(isAdmin
                ? [
                    {
                      header: 'Organization',
                      cell: (m: OrgMember) => (
                        <span className="text-mist">{m.organization_name || 'Unassigned'}</span>
                      )
                    }
                  ]
                : []),
              { header: 'Role', cell: (m) => <span className="text-emerald uppercase">{m.role}</span> },
              {
                header: 'Last login',
                cell: (m) => (
                  <span className="text-mist whitespace-nowrap">
                    {m.last_login ? new Date(m.last_login).toLocaleString() : 'Never'}
                  </span>
                )
              },
              {
                header: '',
                cell: (m) => (
                  <Button onClick={() => handlePickMember(m)} title="Edit this member's role below">
                    <PencilLine size={13} />
                    Edit role
                  </Button>
                )
              }
            ]}
          />
        )}
      </Panel>

      <Panel
        title="Update user role"
        subtitle="UPDATE via PUT /api/v1/users/:userId/role — admin or manager"
        icon={<UserCog size={18} />}
      >
        <form onSubmit={handleUpdateRole} className="flex flex-col gap-4">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
          {!isAdmin && (
            <Alert kind="info">
              Your role is <strong>manager</strong>. You can reassign roles for members of your own
              organization only — an <strong>admin</strong> can reassign anyone on the platform.
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Target user ID"
              value={targetUserId}
              onChange={setTargetUserId}
              required
              placeholder="uuid of the user to modify"
              hint="Pick a member from the roster above, or paste a user ID directly."
            />
            <Select label="New role" value={role} onChange={setRole} options={ROLE_OPTIONS} required />
          </div>

          <Button type="submit" variant="primary" loading={saving} disabled={!targetUserId}>
            Apply role change
          </Button>
        </form>

        <p className="text-[10px] text-mist leading-relaxed mt-4">
          User rows are created by a database trigger on Supabase auth signup. The gateway still
          exposes no delete endpoint.
        </p>
      </Panel>
    </div>
  );
}
