const fs = require('fs');
let file = fs.readFileSync('d:/Projects/teledrive/app/src/screens/FilePreviewScreen.tsx', 'utf8');

// 1. Swap import
file = file.replace(/import \{ theme \} from '\.\.\/ui\/theme';/g, `import { theme as staticTheme } from '../ui/theme';\nimport { useTheme } from '../context/ThemeContext';`);

// 2. Add useTheme hook to ImagePreview, PdfOpenButton, FilePreviewScreen
file = file.replace(/const ImagePreview = React\.memo\(\(\{.*\}\: any\) => \{/g, `$&
    const { theme } = useTheme();`);
file = file.replace(/function PdfOpenButton\(\{.*\}\) \{/g, `$&
    const { theme } = useTheme();`);
file = file.replace(/export default function FilePreviewScreen\(\{.*\}\: any\) \{/g, `$&
    const { theme } = useTheme();`);

// 3. Move styles inside component as useMemo
file = file.replace(/return \(\s*<SafeAreaView style=\{styles\.container\}>/g, `const styles = React.useMemo(() => StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.colors.background },
        header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: theme.spacing.lg, zIndex: 10 },
        headerActions: { flexDirection: 'row', gap: theme.spacing.sm },
        glassBtn: { width: 44, height: 44, borderRadius: theme.radius.full, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },

        previewContainer: { flex: 1 },
        previewImage: { width: '100%', height: '100%' },
        genericPreview: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing['2xl'], flex: 1 },
        genericLabel: { color: theme.colors.textHeading, fontSize: theme.typography.title.fontSize, fontWeight: theme.typography.title.fontWeight as any, marginTop: theme.spacing.xl, textAlign: 'center' },
        genericSub: { color: theme.colors.textBody, fontSize: theme.typography.caption.fontSize, marginTop: theme.spacing.sm },

        dotRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: theme.spacing.sm },
        dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.border },
        dotActive: { width: 18, backgroundColor: theme.colors.primary },

        detailSheet: { backgroundColor: theme.colors.card, borderTopLeftRadius: theme.radius.modal, borderTopRightRadius: theme.radius.modal, padding: theme.spacing.xl, paddingBottom: theme.spacing['3xl'] },
        fileName: { fontSize: theme.typography.title.fontSize, fontWeight: theme.typography.title.fontWeight as any, color: theme.colors.textHeading, marginBottom: 6 },
        fileMeta: { fontSize: theme.typography.caption.fontSize, color: theme.colors.textBody, marginBottom: theme.spacing.xl },
        actionRow: { flexDirection: 'row', gap: theme.spacing.md },
        primaryBtn: { flex: 1, flexDirection: 'row', backgroundColor: theme.colors.primary, height: 54, borderRadius: theme.radius.card, justifyContent: 'center', alignItems: 'center', gap: theme.spacing.sm, ...staticTheme.shadows.elevation1 },
        primaryBtnText: { color: '#fff', fontSize: theme.typography.body.fontSize, fontWeight: theme.typography.hero.fontWeight as any },
        secondaryBtn: { width: 54, height: 54, backgroundColor: theme.colors.inputBg, borderRadius: theme.radius.card, justifyContent: 'center', alignItems: 'center' },

        overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
        bottomSheet: { backgroundColor: theme.colors.card, borderTopLeftRadius: theme.radius.modal, borderTopRightRadius: theme.radius.modal, padding: theme.spacing.xl, paddingBottom: theme.spacing['4xl'] },
        sheetHandle: { width: 40, height: 4, backgroundColor: theme.colors.border, borderRadius: theme.radius.full, alignSelf: 'center', marginBottom: theme.spacing.xl },
        sheetTitle: { fontSize: theme.typography.title.fontSize, fontWeight: theme.typography.title.fontWeight as any, color: theme.colors.textHeading, marginBottom: theme.spacing.lg },

        linkBox: { backgroundColor: theme.colors.inputBg, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.lg },
        linkText: { fontSize: theme.typography.caption.fontSize, color: theme.colors.textBody, lineHeight: 20 },
        copyBtn: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md, height: 50, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: theme.spacing.sm },
        copyBtnText: { color: '#fff', fontWeight: theme.typography.hero.fontWeight as any, fontSize: theme.typography.body.fontSize },
        linkSub: { fontSize: theme.typography.metadata.fontSize, color: theme.colors.textBody, textAlign: 'center', marginTop: theme.spacing.md },

        moveRow: { paddingVertical: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
        moveLabel: { fontSize: theme.typography.body.fontSize, fontWeight: theme.typography.subtitle.fontWeight as any, color: theme.colors.textHeading },

        centeredOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: theme.spacing.xl },
        modalCard: { width: '100%', backgroundColor: theme.colors.card, borderRadius: theme.radius.modal, padding: theme.spacing.xl, ...staticTheme.shadows.elevation2 },
        renameInput: { borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 50, fontSize: theme.typography.body.fontSize, marginBottom: theme.spacing.lg, color: theme.colors.textHeading },
    }), [theme]);

    $&`);

// 4. Remove the old stylesheet
file = file.replace(/const styles = StyleSheet\.create\(\{[\s\S]*?\}\);\s*$/g, '');

fs.writeFileSync('d:/Projects/teledrive/app/src/screens/FilePreviewScreen.tsx', file);
console.log('FilePreviewScreen dynamic theme implemented successfully.');
