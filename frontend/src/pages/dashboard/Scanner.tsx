import ScannerPanel from '../../components/console/ScannerPanel';
import { useDashboard } from '../../lib/dashboardContext';

export default function Scanner() {
  const { selectedRepo } = useDashboard();
  return <ScannerPanel key={selectedRepo?.repository_id ?? 'none'} selectedRepo={selectedRepo} />;
}
