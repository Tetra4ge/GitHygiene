// Phase 4 §2.2 — requirements.txt. Only pinned lines (`name==version`) can be
// matched to a vulnerability by exact version, so unpinned requirements are
// skipped and counted rather than guessed at. All packages are direct; there
// are no edges (requirements.txt carries no dependency tree).

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

function parsePipRequirements(fileText) {
  const lines = fileText.split(/\r?\n/);
  const packages = [];
  let unpinnedSkipped = 0;

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    if (line.startsWith('-')) continue; // option lines (-r, --hash, etc.)

    const pinned = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*([^\s;,]+)/);
    if (!pinned) {
      unpinnedSkipped += 1;
      continue;
    }

    packages.push({
      ecosystem: 'PyPI',
      name: normalizeName(pinned[1]),
      version: pinned[2].trim(),
      isDirect: true
    });
  }

  return { packages, edges: [], unpinnedSkipped };
}

module.exports = { parsePipRequirements, normalizeName };
