import { useNavigate } from 'react-router-dom';
import ReposPanel from '../../components/console/ReposPanel';
import { useDashboard } from '../../lib/dashboardContext';
import type { Repository } from '../../lib/types';

export default function Repositories() {
  const navigate = useNavigate();
  const { githubRepos, setGithubRepos, setSelectedRepo } = useDashboard();

  const handleSelectRepo = (repo: Repository) => {
    setSelectedRepo(repo);
    navigate('/dashboard/manifests');
  };

  const handleSelectRepoForScan = (repo: Repository) => {
    setSelectedRepo(repo);
    navigate('/dashboard/scanner');
  };

  return (
    <ReposPanel
      onSelectRepo={handleSelectRepo}
      onSelectRepoForScan={handleSelectRepoForScan}
      remoteRepos={githubRepos}
      onRemoteReposChange={setGithubRepos}
    />
  );
}
