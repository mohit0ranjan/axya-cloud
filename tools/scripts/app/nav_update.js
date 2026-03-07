const fs = require('fs');

let appSrc = fs.readFileSync('d:/Projects/teledrive/app/App.tsx', 'utf8');

appSrc = appSrc.replace(`import SharedSpaceScreen from './src/screens/SharedSpaceScreen';`, `import SharedSpaceScreen from './src/screens/SharedSpaceScreen';\nimport MainTabs from './src/navigation/MainTabs';`);

appSrc = appSrc.replace(/<Stack\.Screen name="Home" component=\{HomeScreen\} \/>/, `<Stack.Screen name="MainTabs" component={MainTabs} />`);

appSrc = appSrc.replace(/<Stack\.Screen name="Folders" component=\{FoldersScreen\} \/>\n/g, '');
appSrc = appSrc.replace(/<Stack\.Screen name="Starred" component=\{StarredScreen\} \/>\n/g, '');
appSrc = appSrc.replace(/<Stack\.Screen name="Profile" component=\{ProfileScreen\} \/>\n/g, '');

fs.writeFileSync('d:/Projects/teledrive/app/App.tsx', appSrc);
console.log('App.tsx updated to use MainTabs');

let homeSrc = fs.readFileSync('d:/Projects/teledrive/app/src/screens/HomeScreen.tsx', 'utf8');

// Add DeviceEventEmitter import if not present
if (!homeSrc.includes('DeviceEventEmitter')) {
    homeSrc = homeSrc.replace(`import {`, `import {\n    DeviceEventEmitter,`);
}

// Ensure fabOpen respects DeviceEventEmitter
homeSrc = homeSrc.replace(/const \[fabOpen, setFabOpen\] = useState\(false\);/, `const [fabOpen, setFabOpen] = useState(false);\n\n    useEffect(() => {\n        const sub = DeviceEventEmitter.addListener('openGlobalFab', () => setFabOpen(true));\n        return () => sub.remove();\n    }, []);`);

// Remove BOTTOM NAV from HomeScreen JSX
homeSrc = homeSrc.replace(/\{\/\* ═══════════════════════════════════════════════════════════════\s*BOTTOM NAV\s*═══════════════════════════════════════════════════════════════ \*\/\}\s*<View style=\{\[s\.navBar[\s\S]*?<\/View>\s*\{\/\* ═══════════════════════════════════════════════════════════════\s*FAB ACTION SHEET/, `{/* ═══════════════════════════════════════════════════════════════\n                FAB ACTION SHEET`);

fs.writeFileSync('d:/Projects/teledrive/app/src/screens/HomeScreen.tsx', homeSrc);
console.log('HomeScreen updated to remove bottom nav and use global FAB event');

