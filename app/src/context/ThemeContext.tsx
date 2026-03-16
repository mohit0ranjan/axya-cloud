import React, { createContext, useContext, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark';

// ── Shared structural tokens (same for light/dark) ──
const sharedTokens = {
    spacing: {
        xs: 4, sm: 8, md: 12, lg: 16, xl: 24,
        '2xl': 32, '3xl': 40, '4xl': 48,
    },
    radius: {
        sm: 8, md: 12, lg: 16, xl: 24, hero: 32, button: 16, card: 24, modal: 24,
        full: 9999, badge: 8, circle: 9999,
    },
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
};

export const lightTheme = {
    mode: 'light' as ThemeMode,
    ...sharedTokens,
    colors: {
        background: '#F7F8FC',
        card: '#FFFFFF',
        primary: '#3B82F6',
        primaryDark: '#2563EB',
        primaryLight: '#DBEAFE',
        gradientStart: '#3B82F6',
        gradientMid: '#6366F1',
        gradientEnd: '#7C3AED',
        fabGradientStart: '#4F46E5',
        fabGradientEnd: '#2563EB',
        accent: '#FCBD0B',
        danger: '#EF4444',
        success: '#22C55E',
        storageImages: '#FACC15',
        storageVideos: '#FB7185',
        storageFiles: '#38BDF8',
        textHeading: '#1A1F36',
        textBody: '#8892A4',
        border: '#E5E7EB',
        muted: '#94A3B8',
        overlay: 'rgba(0,0,0,0.4)',
        inputBg: '#F7F8FC',
        purple: '#9333EA',
        neutral: {
            50: '#F7F8FC', 100: '#F1F3F9', 200: '#E5E7EB', 300: '#CBD5E1',
            400: '#94A3B8', 500: '#8892A4', 600: '#475569', 700: '#334155',
            800: '#1E293B', 900: '#1A1F36',
        },
    },
    shadows: {
        iconButton: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
        card: { shadowColor: '#8a95a5', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
        soft: { shadowColor: '#6366F1', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 12 },
        elevation1: { shadowColor: '#1A1F36', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
        elevation2: { shadowColor: '#1A1F36', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.1, shadowRadius: 24, elevation: 6 },
        elevation3: { shadowColor: '#4F46E5', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 20, elevation: 10 },
        heroGlow: { shadowColor: '#6366F1', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 14 },
    },
};

export const darkTheme: typeof lightTheme = {
    mode: 'dark',
    ...sharedTokens,
    colors: {
        background: '#0D0F1A',
        card: '#1A1E2E',
        primary: '#60A5FA',
        primaryDark: '#3B82F6',
        primaryLight: '#1E2540',
        gradientStart: '#3B82F6',
        gradientMid: '#6366F1',
        gradientEnd: '#7C3AED',
        fabGradientStart: '#4F46E5',
        fabGradientEnd: '#2563EB',
        accent: '#FCBD0B',
        danger: '#FF5252',
        success: '#22C55E',
        storageImages: '#FACC15',
        storageVideos: '#FB7185',
        storageFiles: '#38BDF8',
        textHeading: '#E8EAF0',
        textBody: '#6B7A99',
        border: '#252A3E',
        muted: '#4F5B76',
        overlay: 'rgba(0,0,0,0.7)',
        inputBg: '#141828',
        purple: '#A855F7',
        neutral: {
            50: '#0D0F1A', 100: '#141828', 200: '#252A3E', 300: '#353B52',
            400: '#4F5B76', 500: '#6B7A99', 600: '#8892A4', 700: '#A5B0C5',
            800: '#E8EAF0', 900: '#F1F3F9',
        },
    },
    shadows: {
        iconButton: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 3 },
        card: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 4 },
        soft: { shadowColor: '#6366F1', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 8 },
        elevation1: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 2 },
        elevation2: { shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.25, shadowRadius: 24, elevation: 4 },
        elevation3: { shadowColor: '#4F46E5', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 20, elevation: 10 },
        heroGlow: { shadowColor: '#6366F1', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 14 },
    },
};

interface ThemeContextType {
    theme: typeof lightTheme;
    isDark: boolean;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
    theme: lightTheme,
    isDark: false,
    toggleTheme: () => { },
});

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
    // Start with null to indicate loading state - prevents flash of wrong theme
    const [isDark, setIsDark] = useState<boolean | null>(null);

    const toggleTheme = async () => {
        if (isDark === null) return;
        const next = !isDark;
        setIsDark(next);
        await AsyncStorage.setItem('@theme_mode', next ? 'dark' : 'light');
    };

    // Load theme preference on mount
    React.useEffect(() => {
        AsyncStorage.getItem('@theme_mode').then(mode => {
            setIsDark(mode === 'dark');
        }).catch(() => {
            // Default to light theme on error
            setIsDark(false);
        });
    }, []);

    // Wait for theme to load before rendering children
    // This prevents flash of wrong theme on app start
    if (isDark === null) {
        return null;
    }

    return (
        <ThemeContext.Provider value={{ theme: isDark ? darkTheme : lightTheme, isDark, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
