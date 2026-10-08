// Phase 8 §2.1 / AI_DESIGN.md §3.3 — the model chooses a remediation
// *strategy*; the patch string itself is generated here, deterministically,
// from facts (package name, fixed version, package manager). A model-authored
// overrides/resolutions stanza is the failure mode that looks right, parses
// fine, and silently fixes nothing — so it is never asked to write one.

function buildPatch({ strategy, packageManager, packageName, directDependencyName, fixedVersion }) {
  if (!fixedVersion) {
    return { patch: null, note: 'No fixed version is published for this advisory yet.' };
  }

  if (strategy === 'direct-bump') {
    if (packageManager === 'pip') {
      return { patch: `pip install ${packageName}==${fixedVersion}`, filesToChange: ['requirements.txt'] };
    }
    return { patch: `npm install ${packageName}@${fixedVersion}`, filesToChange: ['package.json', 'package-lock.json'] };
  }

  if (strategy === 'override') {
    if (packageManager === 'pip') {
      return {
        patch: `# constraints.txt\n${packageName}==${fixedVersion}\n\n# install with:\npip install -c constraints.txt -r requirements.txt`,
        filesToChange: ['constraints.txt']
      };
    }
    // npm >=8.3 "overrides"; the same shape works for pnpm. Yarn uses
    // "resolutions" with identical semantics — noted, not auto-detected,
    // since the package manager in `dependencies.package_manager` doesn't
    // currently distinguish npm from yarn/pnpm (both are tracked as 'npm').
    return {
      patch: JSON.stringify({ overrides: { [packageName]: fixedVersion } }, null, 2),
      note:
        'Add this to package.json ("resolutions" instead of "overrides" if this project uses Yarn). ' +
        (directDependencyName
          ? `Pulled in transitively through "${directDependencyName}".`
          : 'Dependency path to the direct parent is unknown — verify before applying.'),
      filesToChange: ['package.json', 'package-lock.json']
    };
  }

  return { patch: null, note: `Unknown remediation strategy: ${strategy}` };
}

module.exports = { buildPatch };
