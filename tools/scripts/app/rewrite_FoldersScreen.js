const fs = require('fs');
let file = fs.readFileSync('d:/Projects/teledrive/app/src/screens/FoldersScreen.tsx', 'utf8');

file = file.replace(/import \{ theme \} from '\.\.\/ui\/theme';/g, `import { theme as staticTheme } from '../ui/theme';
import { useTheme } from '../context/ThemeContext';`);

file = file.replace(/export default function FoldersScreen\(\{ navigation \}: any\) \{/g, `export default function FoldersScreen({ navigation }: any) {
    const { theme } = useTheme();`);

file = file.replace(/const currentSort = SORT_OPTIONS\.find[\s\S]*?return \(/, `const currentSort = SORT_OPTIONS.find(s => s.key === sortKey) ?? SORT_OPTIONS[0];

    const styles = React.useMemo(() => StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.colors.background },
        header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 20 },
        backBtn: { padding: 8, marginLeft: -8 },
        headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        addBtn: { padding: 4 },
        sortBtn: {
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 10, borderRadius: 20, height: 34,
            backgroundColor: theme.colors.background,
            maxWidth: 130,
        },
        sortBtnText: { fontSize: 12, fontWeight: '600', color: theme.colors.primary },

        titleSection: { paddingHorizontal: 24, marginTop: 24, marginBottom: 24 },
        pageTitle: { fontSize: 30, fontWeight: '400', color: theme.colors.textHeading, letterSpacing: -0.5, marginBottom: 6 },
        statsSubtitle: { fontSize: 13, color: theme.colors.textBody },

        scrollArea: { flex: 1, paddingHorizontal: 24 },
        gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
        emptyText: { width: '100%', textAlign: 'center', marginTop: 40, color: theme.colors.textBody, fontSize: 14 },

        folderCard: {
            width: CARD_WIDTH,
            backgroundColor: theme.colors.card,
            borderRadius: 24,
            padding: 16,
            marginBottom: CARD_MARGIN,
            ...staticTheme.shadows.card,
            minHeight: 140,
            justifyContent: 'space-between'
        },
        cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
        iconBox: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
        cardFooter: { marginTop: 20 },
        folderName: { fontSize: 15, fontWeight: '700', color: theme.colors.textHeading, marginBottom: 4 },
        folderMeta: { fontSize: 11, color: theme.colors.textBody, fontWeight: '500' },

        modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
        modalCard: { width: '100%', backgroundColor: theme.colors.card, borderRadius: 24, padding: 24, ...staticTheme.shadows.card },
        modalTitle: { fontSize: 20, fontWeight: '700', color: theme.colors.textHeading, marginBottom: 16 },
        modalInput: { width: '100%', height: 50, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, marginBottom: 20, color: theme.colors.textHeading },
        modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
        modalBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.inputBg },
        modalBtnText: { color: theme.colors.textHeading, fontWeight: '600', fontSize: 14 },

        // Sort modal
        sortModalOverlay: {
            flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
            justifyContent: 'flex-end',
        },
        sortSheet: {
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 20, paddingTop: 12,
            backgroundColor: theme.colors.card,
        },
        sortHandle: {
            width: 36, height: 4, borderRadius: 2,
            alignSelf: 'center', marginBottom: 16,
            backgroundColor: theme.colors.border,
        },
        sortSheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: theme.colors.textHeading },
        sortRow: {
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingVertical: 14, paddingHorizontal: 12,
            borderRadius: 12, marginBottom: 4,
        },
        sortRowText: { flex: 1, fontSize: 15 },
        sortCheck: {
            width: 20, height: 20, borderRadius: 10,
            justifyContent: 'center', alignItems: 'center',
        },
    }), [theme]);

    return (`);

file = file.replace(/const styles = StyleSheet\.create\(\{[\s\S]*?\}\);\s*$/g, '');

fs.writeFileSync('d:/Projects/teledrive/app/src/screens/FoldersScreen.tsx', file);
console.log('FoldersScreen dynamic theme implemented successfully.');
