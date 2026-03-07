const fs = require('fs');
let file = fs.readFileSync('d:/Projects/teledrive/app/src/screens/HomeScreen.tsx', 'utf8');

const regexMap = [
    { name: 'Folders', regex: /\{\/\*\s*═══════════════════════════════════════════════════════════\s*FOLDERS SECTION\s*═══════════════════════════════════════════════════════════\s*\*\/\}/ },
    { name: 'RecentlyOpened', regex: /\{\/\*\s*═══════════════════════════════════════════════════════════\s*RECENTLY OPENED SECTION\s*═══════════════════════════════════════════════════════════\s*\*\/\}/ },
    { name: 'RecentFiles', regex: /\{\/\*\s*═══════════════════════════════════════════════════════════\s*RECENT FILES\s*═══════════════════════════════════════════════════════════\s*\*\/\}/ },
    { name: 'Activity', regex: /\{\/\*\s*═══════════════════════════════════════════════════════════\s*RECENT ACTIVITY\s*═══════════════════════════════════════════════════════════\s*\*\/\}/ },
    { name: 'BottomNav', regex: /\{\/\*\s*═══════════════════════════════════════════════════════════════\s*BOTTOM NAV\s*═══════════════════════════════════════════════════════════════\s*\*\/\}/ }
];

const match1 = file.match(regexMap[0].regex);
const match2 = file.match(regexMap[1].regex);
const match3 = file.match(regexMap[2].regex);
const match4 = file.match(regexMap[3].regex);
const match5 = file.match(regexMap[4].regex);

if (!match1 || !match2 || !match3 || !match4 || !match5) {
    console.log("Matches found:", !!match1, !!match2, !!match3, !!match4, !!match5);
    process.exit(1);
}

const f1 = match1.index;
const f2 = match2.index;
const f3 = match3.index;
const f4 = match4.index;
const f5 = match5.index;

const foldersContent = file.substring(f1 + match1[0].length, f2).trim();
const recentlyOpenedContent = file.substring(f2 + match2[0].length, f3).trim();
const recentFilesContent = file.substring(f3 + match3[0].length, f4).trim();
const activityContent = file.substring(f4 + match4[0].length, f5).trim();

// Create Memoized Components
const newComponents = `
// ── Extracted Memoized Components ─────────────────────────────────────────────

const MemoizedFoldersSection = React.memo(({
    searchQuery, navigation, loading, folders, setFabOpen, setFolderModal, C, s, stats,
    setOptionsTarget, pinnedFolderIds, toggleFolderPinned, setRenameFolderTarget,
    setRenameFolderName, setRenameFolderModal, apiClient, showToast, load, normalizeFolderId
}: any) => {
    return (
        <React.Fragment>
            ${foldersContent}
        </React.Fragment>
    );
});

const MemoizedRecentlyOpenedSection = React.memo(({
    searchQuery, recentlyAccessed, s, navigation, token, apiClient, C
}: any) => {
    return (
        <React.Fragment>
            ${recentlyOpenedContent}
        </React.Fragment>
    );
});

const MemoizedRecentFilesSection = React.memo(({
    searchQuery, s, navigation, C, loading, searching, displayItems, getIconConfig,
    recentFiles, token, apiClient, formatSize, formatDate
}: any) => {
    return (
        <React.Fragment>
            ${recentFilesContent}
        </React.Fragment>
    );
});

const MemoizedActivitySection = React.memo(({
    searchQuery, activity, HOME_ACTIVITY_PREVIEW_LIMIT, s, C, user, formatDate
}: any) => {
    return (
        <React.Fragment>
            ${activityContent}
        </React.Fragment>
    );
});
`;

let newFile = file.substring(0, f1);
newFile += match1[0] + "\n";
newFile += `                <MemoizedFoldersSection 
                    searchQuery={searchQuery} navigation={navigation} loading={loading} 
                    folders={folders} setFabOpen={setFabOpen} setFolderModal={setFolderModal} 
                    C={C} s={s} stats={stats} setOptionsTarget={typeof setOptionsTarget !== 'undefined' ? setOptionsTarget : null} 
                    pinnedFolderIds={pinnedFolderIds} toggleFolderPinned={typeof toggleFolderPinned !== 'undefined' ? toggleFolderPinned : null} 
                    setRenameFolderTarget={setRenameFolderTarget} setRenameFolderName={setRenameFolderName} 
                    setRenameFolderModal={setRenameFolderModal} apiClient={apiClient} 
                    showToast={showToast} load={load} normalizeFolderId={typeof normalizeFolderId !== 'undefined' ? normalizeFolderId : null}
                />\n\n                `;

newFile += match2[0] + "\n";
newFile += `                <MemoizedRecentlyOpenedSection 
                    searchQuery={searchQuery} recentlyAccessed={recentlyAccessed} 
                    s={s} navigation={navigation} token={token} apiClient={apiClient} C={C} 
                />\n\n                `;

newFile += match3[0] + "\n";
newFile += `                <MemoizedRecentFilesSection 
                    searchQuery={searchQuery} s={s} navigation={navigation} C={C} 
                    loading={loading} searching={searching} displayItems={displayItems} 
                    getIconConfig={getIconConfig} recentFiles={recentFiles} token={token} 
                    apiClient={apiClient} formatSize={formatSize} formatDate={formatDate}
                />\n\n                `;

newFile += match4[0] + "\n";
newFile += `                <MemoizedActivitySection 
                    searchQuery={searchQuery} activity={activity} HOME_ACTIVITY_PREVIEW_LIMIT={HOME_ACTIVITY_PREVIEW_LIMIT} 
                    s={s} C={C} user={user} formatDate={formatDate}
                />\n\n                `;

newFile += file.substring(f5);

// Insert the new components right before 'export default function HomeScreen'
newFile = newFile.replace('export default function HomeScreen', newComponents + '\\nexport default function HomeScreen');

fs.writeFileSync('d:/Projects/teledrive/app/src/screens/HomeScreen.tsx', newFile);
console.log('HomeScreen component extraction complete.');
