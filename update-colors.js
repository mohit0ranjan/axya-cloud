const fs = require('fs');

let file = fs.readFileSync('app/src/screens/FoldersScreen.tsx', 'utf8');

// Replace FOLDER_COLORS setup
file = file.replace(
    /const FOLDER_COLORS = \['#E0E7FF'.*?\];\nconst getFolderColor/m,
    \const FOLDER_THEMES = [
    { bg: '#F0FDF4', icon: '#22C55E', more: '#86EFAC' },
    { bg: '#FEFCE8', icon: '#EAB308', more: '#FDE047' },
    { bg: '#FFF1F2', icon: '#F43F5E', more: '#FDA4AF' },
    { bg: '#F5F3FF', icon: '#8B5CF6', more: '#C4B5FD' },
    { bg: '#ECFEFF', icon: '#06B6D4', more: '#67E8F9' },
];
const getFolderColor\
);

file = file.replace(
    /FOLDER_COLORS\[index \% FOLDER_COLORS\.length\]/g,
    \FOLDER_THEMES[index % FOLDER_THEMES.length]\
);

// Replace mapped background
file = file.replace(
    /\{ backgroundColor\: \\\\$\\\{folder\.color\\\}15\ \}/g,
    \{ backgroundColor: folder.color.bg }\
);

// Replace mapping folder icon color
file = file.replace(
    /<FolderIcon color="\#2563EB" size=\{24\} fill="transparent" strokeWidth=\{2\} \/>/g,
    (match, offset, fullString) => {
        // We only want to replace the SECOND ONE which is inside the mapping loop, not the hardcoded All Files.
        // Wait, just simpler:
        return match;
    }
);

// Actually, we can just replace both, then fix All Files.
file = file.replace(/<FolderIcon color="\#2563EB" size=\{24\} fill="transparent" strokeWidth=\{2\} \/>/g, '<FolderIcon color={folder.color ? folder.color.icon : "#3B82F6"} size={24} strokeWidth={2} />');

// Replace more horizontal 
file = file.replace(
    /icon=\{<MoreHorizontal color=\{folder\.color\} size=\{20\} \/>\}/g,
    \icon={<MoreHorizontal color={folder.color.more} size={20} />}\
);

fs.writeFileSync('app/src/screens/FoldersScreen.tsx', file);
console.log('Update colors OK');