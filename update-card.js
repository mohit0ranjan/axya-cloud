const fs = require('fs');

let file = fs.readFileSync('app/src/components/FileListItem.tsx', 'utf8');

// Update font weights and colors
file = file.replace(
    /fileName: \{\n        fontSize: 16,\n        fontWeight: '500',\n        color: '#1A2035',\n        marginBottom: 2,\n    \},/m,
    \ileName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#0F172A',
        marginBottom: 4,
    },\
);

file = file.replace(
    /fileMeta: \{\n        fontSize: 13,\n        color: '#8892A4',\n        fontWeight: '400',\n    \},/m,
    \ileMeta: {
        fontSize: 13,
        color: '#64748B',
        fontWeight: '500',
    },\
);

file = file.replace(
    /<ChevronRight color=\{isFolder \? "\#CBD5E1" : "\#F1F5F9"\} size=\{20\} \/>/g,
    \<ChevronRight color="#E2E8F0" size={20} />\
);

// Update fileIconCard dimensions
file = file.replace(
    /fileIconCard: \{\n        width: 48,\n        height: 48,\n        marginRight: 18,\n    \},/m,
    \ileIconCard: {
        width: 52,
        height: 52,
        marginRight: 16,
    },\
);

// Ensure the radius logic uses 16px or even 18px for images like the screenshot.
file = file.replace(
    /variant === 'card' && !isFolder \? \{ borderRadius: 16 \} : null/g,
    \ariant === 'card' && !isFolder ? { borderRadius: 18 } : null\
);

fs.writeFileSync('app/src/components/FileListItem.tsx', file);
console.log('Done FileListItem');
