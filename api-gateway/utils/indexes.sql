-- speeds up "find dependency by package name" (used in the security scan)
CREATE INDEX IF NOT EXISTS idx_dependencies_package ON dependencies(package_name);

-- speeds up "find all alerts for a repo"
CREATE INDEX IF NOT EXISTS idx_alerts_repository ON security_alerts(repository_id);

-- speeds up CVE lookups by number during scan matching
CREATE INDEX IF NOT EXISTS idx_cves_number ON cves(cve_number);
