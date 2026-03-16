export const theme = {
    // ── 2.1 Color System ──
    colors: {
        // Brand Primary
        primary: '#3B82F6',
        primaryDark: '#2563EB',
        primaryLight: '#DBEAFE',
        gradientStart: '#3B82F6',
        gradientMid: '#6366F1',
        gradientEnd: '#7C3AED',
        fabGradientStart: '#4F46E5',
        fabGradientEnd: '#2563EB',

        // Semantic States
        success: '#22C55E',
        error: '#EF4444',
        warning: '#F59E0B',
        info: '#06B6D4',

        // Storage indicators
        storageImages: '#FACC15',
        storageVideos: '#FB7185',
        storageFiles: '#38BDF8',

        // Neutral Scale
        neutral: {
            50: '#F7F8FC',  // Main Background
            100: '#F1F3F9', // Subtle borders
            200: '#E5E7EB', // Borders
            300: '#CBD5E1',
            400: '#94A3B8', // Disabled / Icons
            500: '#8892A4', // Muted Text (Metadata)
            600: '#475569',
            700: '#334155', // Body Text
            800: '#1E293B',
            900: '#1A1F36', // Heading Text (Card Titles)
        },

        // Legacy Aliases (to prevent massive breakage until full migration)
        background: '#F7F8FC',
        card: '#FFFFFF',
        textHeading: '#1A1F36',
        textBody: '#475569',
        border: '#E5E7EB',
        danger: '#EF4444',
        accent: '#FCBD0B',
    },

    // ── 2.2 Spacing System (8px Grid) ──
    spacing: {
        xs: 4,
        sm: 8,
        md: 12,
        lg: 16,
        xl: 24,
        '2xl': 32,
        '3xl': 40,
        '4xl': 48,
    },

    // ── 2.3 Border Radius Rules ──
    radius: {
        sm: 8,
        md: 12,
        lg: 16,
        xl: 24,
        hero: 32,
        button: 16,     // 14-18 standard
        card: 24,
        modal: 24,
        full: 9999,     // Pills/Circles

        // Legacy
        badge: 8,
        circle: 9999,
    },

    // ── 2.4 Shadow System (Elevation) ──
    shadows: {
        iconButton: {
            shadowColor: '#0F172A',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.06,
            shadowRadius: 10,
            elevation: 3,
        },
        // Elevation 1 -> Light shadow (Cards)
        elevation1: {
            shadowColor: '#1A1F36',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.06,
            shadowRadius: 10,
            elevation: 3,
        },
        // Elevation 2 -> Modals / Bottom Sheets
        elevation2: {
            shadowColor: '#1A1F36',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.1,
            shadowRadius: 24,
            elevation: 6,
        },
        // Elevation 3 -> Floating Action Buttons
        elevation3: {
            shadowColor: '#4F46E5',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.35,
            shadowRadius: 20,
            elevation: 10,
        },
        heroGlow: {
            shadowColor: '#6366F1',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.25,
            shadowRadius: 20,
            elevation: 14,
        },
        // Legacy
        soft: { shadowColor: '#3174ff', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 8 },
        card: { shadowColor: '#1A1F36', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 }
    },

    // ── 2.5 Typography Hierarchy ──
    typography: {
        greeting: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.5 },
        section: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },
        cardTitle: { fontSize: 16, fontWeight: '600' as const },
        meta: { fontSize: 12, fontWeight: '500' as const },
        nav: { fontSize: 10, fontWeight: '600' as const },
        hero: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
        title: { fontSize: 18, fontWeight: '600' as const },
        subtitle: { fontSize: 16, fontWeight: '500' as const },
        body: { fontSize: 15, fontWeight: '400' as const },
        caption: { fontSize: 13, fontWeight: '400' as const },
        metadata: { fontSize: 12, fontWeight: '500' as const, color: '#8892A4' },
    },

    // ── 2.6 Card Presets (Standardized) ──
    cardPresets: {
        file: {
            paddingVertical: 12,
            paddingHorizontal: 0,
        },
        folder: {
            padding: 16,
            borderRadius: 16,
            minHeight: 120,
        },
        modal: {
            borderRadius: 24,
            padding: 24,
        },
    },

    // ── 1.1 Motion System ──
    motion: {
        duration: 250, // Standard 220-280ms
        spring: { damping: 20, stiffness: 200 }, // Slight bounce
        scaleBtn: 0.97,
    }
};
