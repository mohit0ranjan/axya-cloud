import React from 'react';
import { View, StyleSheet, Animated, Platform } from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface SkeletonProps {
    width?: number | string;
    height?: number;
    borderRadius?: number;
    style?: object;
}

export const SkeletonBlock = ({ width = '100%', height = 20, borderRadius = 8, style }: SkeletonProps) => {
    const { isDark } = useTheme();
    const baseBg = isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9';
    const staticBg = isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0';

    // ── Web: react-native-web doesn't support Animated native driver
    if (Platform.OS === 'web') {
        return (
            <View
                style={[
                    { width: width as any, height, borderRadius, backgroundColor: staticBg },
                    style,
                ]}
            />
        );
    }

    // ── Native: full pulse animation ──────────────────────────────────────────
    const pulse = React.useRef(new Animated.Value(0.4)).current;

    React.useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: false }),
                Animated.timing(pulse, { toValue: 0.4, duration: 850, useNativeDriver: false }),
            ])
        );
        animation.start();
        return () => animation.stop();
    }, []);

    return (
        <Animated.View
            style={[
                { width: width as any, height, borderRadius, backgroundColor: baseBg, opacity: pulse },
                style,
            ]}
        />
    );
};

export const FileCardSkeleton = () => {
    const { isDark } = useTheme();
    return (
        <View style={styles.card}>
            <SkeletonBlock width={46} height={46} borderRadius={13} />
            <View style={styles.info}>
                <SkeletonBlock width="68%" height={14} borderRadius={7} />
                <View style={{ height: 7 }} />
                <SkeletonBlock width="42%" height={12} borderRadius={6} />
            </View>
        </View>
    );
};

export const FolderCardSkeleton = () => {
    const { isDark } = useTheme();
    const cardBg = isDark ? 'rgba(255,255,255,0.04)' : '#fff';
    const borderColor = isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9';
    return (
        <View style={[styles.folderCard, { backgroundColor: cardBg, borderColor }]}>
            <SkeletonBlock width={46} height={46} borderRadius={13} style={{ marginBottom: 28 }} />
            <SkeletonBlock width="75%" height={14} borderRadius={7} />
            <View style={{ height: 6 }} />
            <SkeletonBlock width="50%" height={11} borderRadius={6} />
        </View>
    );
};

export const StatCardSkeleton = () => {
    const { isDark } = useTheme();
    const cardBg = isDark ? 'rgba(255,255,255,0.04)' : '#fff';
    const borderColor = isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9';
    return (
        <View style={[styles.statCard, { backgroundColor: cardBg, borderColor }]}>
            <SkeletonBlock width={42} height={42} borderRadius={11} style={{ marginBottom: 14 }} />
            <SkeletonBlock width="58%" height={22} borderRadius={8} style={{ marginBottom: 8 }} />
            <SkeletonBlock width="42%" height={12} borderRadius={6} />
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent',
        paddingVertical: 12, marginBottom: 4,
    },
    info: { flex: 1, marginLeft: 16 },
    folderCard: {
        width: '47%', borderRadius: 20, padding: 16,
        marginBottom: 12, minHeight: 138, justifyContent: 'flex-end',
        borderWidth: 1.5,
    },
    statCard: {
        flex: 1, borderRadius: 20, padding: 20,
        borderWidth: 1.5,
    },
});
