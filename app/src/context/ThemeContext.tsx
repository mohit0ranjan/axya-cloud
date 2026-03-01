import React, { createContext, useContext, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark';

export const lightTheme = {
    mode: 'light' as ThemeMode,
    colors: {
        background: '#F4F6FB',
        card: '#FFFFFF',
        primary: '#4B6EF5',
        primaryLight: '#EEF1FD',
        accent: '#FCBD0B',
        danger: '#EF4444',
        success: '#1FD45A',
        textHeading: '#1A1F36',
        textBody: '#8892A4',
        border: '#EAEDF3',
        muted: '#94A3B8',
        overlay: 'rgba(0,0,0,0.4)',
        inputBg: '#F4F6FB',
        purple: '#9333EA',
    },
    shadows: {
        card: { shadowColor: '#8a95a5', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
        soft: { shadowColor: '#4B6EF5', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 8 },
    },
};

export const darkTheme: typeof lightTheme = {
    mode: 'dark',
    colors: {
        background: '#0D0F1A',
        card: '#1A1E2E',
        primary: '#5B7FFF',
        primaryLight: '#1E2540',
        accent: '#FCBD0B',
        danger: '#FF5252',
        success: '#1FD45A',
        textHeading: '#E8EAF0',
        textBody: '#6B7A99',
        border: '#252A3E',
        muted: '#4F5B76',
        overlay: 'rgba(0,0,0,0.7)',
        inputBg: '#141828',
        purple: '#A855F7',
    },
    shadows: {
        card: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 4 },
        soft: { shadowColor: '#5B7FFF', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 8 },
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
    const [isDark, setIsDark] = useState(false);

    const toggleTheme = async () => {
        const next = !isDark;
        setIsDark(next);
        await AsyncStorage.setItem('@theme_mode', next ? 'dark' : 'light');
    };

    // Load on mount
    React.useEffect(() => {
        AsyncStorage.getItem('@theme_mode').then(mode => {
            if (mode === 'dark') setIsDark(true);
        });
    }, []);

    return (
        <ThemeContext.Provider value={{ theme: isDark ? darkTheme : lightTheme, isDark, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
