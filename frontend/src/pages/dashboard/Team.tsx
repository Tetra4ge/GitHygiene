import TeamPanel from '../../components/console/TeamPanel';
import RestrictedPage from '../../components/console/RestrictedPage';
import { useAuthStore } from '../../lib/authStore';

export default function Team() {
  const role = useAuthStore((s) => s.profile?.role);
  if (role && role !== 'admin' && role !== 'manager') {
    return <RestrictedPage page="Team" />;
  }
  return <TeamPanel />;
}
