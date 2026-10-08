import OsvPanel from '../../components/console/OsvPanel';

export default function Security() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display font-bold text-xl text-paper">Security</h1>
        <p className="text-[11px] text-mist mt-1">
          Real advisories from OSV.dev · AI reachability engine · fix-first ranking
        </p>
      </div>
      <OsvPanel />
    </div>
  );
}
