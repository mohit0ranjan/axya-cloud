const fs = require('fs');
let file = fs.readFileSync('d:/Projects/teledrive/app/src/screens/HomeScreen.tsx', 'utf8');

// The closing tag in the Memoized component
file = file.replace(/<\/ScrollView>\s*<\/React\.Fragment>\s*\);\s*}\);/g, `
        </React.Fragment>
    );
});`);

// The missing tag in the main component
file = file.replace(/<MemoizedActivitySection([\s\S]*?)\/>\s*\{\/\* ═══════════════════════════════════════════════════════════════\s*BOTTOM NAV/g, `<MemoizedActivitySection$1/>\n\n            </ScrollView>\n\n            {/* ═══════════════════════════════════════════════════════════════\n                BOTTOM NAV`);

fs.writeFileSync('d:/Projects/teledrive/app/src/screens/HomeScreen.tsx', file);
console.log('Fixed ScrollView tag placement.');
