import ManifestsPanel from '../../components/console/ManifestsPanel';
import { useDashboard } from '../../lib/dashboardContext';

export default function Manifests() {
  const { selectedRepo } = useDashboard();
  // Keyed by repo id: picking a different repository on the Repositories page
  // should remount this panel with fresh form values instead of back-filling
  // through an effect (mirrors the old tab-based Dashboard's behavior).
  return <ManifestsPanel key={selectedRepo?.repository_id ?? 'none'} selectedRepo={selectedRepo} />;
}
