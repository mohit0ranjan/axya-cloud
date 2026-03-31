const fs = require('fs');
const path = require('path');

const metroServerPath = path.resolve(__dirname, '..', 'node_modules', 'metro', 'src', 'Server.js');

const targetSnippet = [
  'const pathname = urlObj.pathname || "";',
  '    const filePathname = pathname',
  '      .split("/")',
  '      .map((segment) => decodeURIComponent(segment))',
  '      .join("/");',
].join('\n');

const patchedSnippet = [
  'const pathname = urlObj.pathname || "";',
  '    const safeDecodeSegment = (segment) => {',
  '      try {',
  '        return decodeURIComponent(segment);',
  '      } catch {',
  '        return segment;',
  '      }',
  '    };',
  '    const filePathname = pathname',
  '      .split("/")',
  '      .map((segment) => safeDecodeSegment(segment))',
  '      .join("/");',
].join('\n');

try {
  if (!fs.existsSync(metroServerPath)) {
    console.log('[patch-metro-safe-decode] Metro Server.js not found. Skipping patch.');
    process.exit(0);
  }

  const source = fs.readFileSync(metroServerPath, 'utf8');

  if (source.includes('safeDecodeSegment')) {
    console.log('[patch-metro-safe-decode] Patch already applied.');
    process.exit(0);
  }

  if (!source.includes(targetSnippet)) {
    console.log('[patch-metro-safe-decode] Target snippet not found. Metro version may differ.');
    process.exit(0);
  }

  const updated = source.replace(targetSnippet, patchedSnippet);
  fs.writeFileSync(metroServerPath, updated, 'utf8');
  console.log('[patch-metro-safe-decode] Patch applied successfully.');
} catch (err) {
  console.error('[patch-metro-safe-decode] Failed to patch Metro:', err);
  process.exit(1);
}
