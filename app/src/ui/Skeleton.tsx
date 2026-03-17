import React from 'react';
import { View, StyleSheet, Animated, Platform, Easing, Dimensions } from 'react-native';
import { useTheme } from '../context/ThemeContext';

const SCREEN_WIDTH = Dimensions.get('window').width;

// ────────────────────────────────────────────────────────────────────────────
// Shared shimmer animation — a single looping Animated.Value that ALL
// SkeletonBlock instances share, guaranteeing every block shimmers in sync.
// ────────────────────────────────────────────────────────────────────────────
const _globalShimmer = new Animated.Value(0);
let _shimmerRunning = false;

function ensureShimmer() {
    if (_shimmerRunning) return;
    _shimmerRunning = true;
    Animated.loop(
        Animated.timing(_globalShimmer, {
            toValue: 1,
            duration: 1400,
            easing: Easing.bezier(0.4, 0.0, 0.6, 1.0),
            useNativeDriver: true,
        })
    ).start();
}

// ────────────────────────────────────────────────────────────────────────────
// SkeletonBlock – the core animated placeholder brick
// ────────────────────────────────────────────────────────────────────────────
interface SkeletonProps {
    width?: number | string;
    height?: number;
    borderRadius?: number;
    style?: object;
    delay?: number; // stagger delay in ms — fades the block in after this delay
}

export const SkeletonBlock = ({
    width = '100%',
    height = 20,
    borderRadius = 8,
    style,
    delay = 0,
}: SkeletonProps) => {
    const { isDark } = useTheme();
    const baseBg = isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9';
    const shimmerColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.65)';
    const staticBg = isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0';

    // ── Web: no native driver support ─────────────────────────────────────
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

    // ── Stagger fade-in ───────────────────────────────────────────────────
    const entryOpacity = React.useRef(new Animated.Value(delay > 0 ? 0 : 1)).current;
    React.useEffect(() => {
        if (delay > 0) {
            const t = setTimeout(() => {
                Animated.timing(entryOpacity, {
                    toValue: 1,
                    duration: 280,
                    useNativeDriver: true,
                }).start();
            }, delay);
            return () => clearTimeout(t);
        }
    }, []);

    // ── Start shared shimmer on mount ─────────────────────────────────────
    React.useEffect(() => {
        ensureShimmer();
    }, []);

    // The shimmer "streak" translates horizontally across the block
    const shimmerTranslate = _globalShimmer.interpolate({
        inputRange: [0, 1],
        outputRange: [-SCREEN_WIDTH, SCREEN_WIDTH],
    });

    return (
        <Animated.View
            style={[
                {
                    width: width as any,
                    height,
                    borderRadius,
                    backgroundColor: baseBg,
                    overflow: 'hidden',
                    opacity: entryOpacity,
                },
                style,
            ]}
        >
            {/* Shimmer streak */}
            <Animated.View
                style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    width: SCREEN_WIDTH * 0.6,
                    backgroundColor: shimmerColor,
                    transform: [{ translateX: shimmerTranslate }],
                    borderRadius,
                }}
            />
        </Animated.View>
    );
};

// ────────────────────────────────────────────────────────────────────────────
// ContentFadeIn — wraps content that replaces skeletons with a smooth fade
// ────────────────────────────────────────────────────────────────────────────
interface ContentFadeInProps {
    visible: boolean;
    duration?: number;
    children: React.ReactNode;
    style?: any;
}

export const ContentFadeIn = ({ visible, duration = 350, children, style }: ContentFadeInProps) => {
    const opacity = React.useRef(new Animated.Value(0)).current;
    const translateY = React.useRef(new Animated.Value(8)).current;

    React.useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.timing(opacity, {
                    toValue: 1,
                    duration,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(translateY, {
                    toValue: 0,
                    duration,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible]);

    if (!visible) return null;

    return (
        <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
            {children}
        </Animated.View>
    );
};

// ────────────────────────────────────────────────────────────────────────────
// Pre-built composite skeletons
// ────────────────────────────────────────────────────────────────────────────
export const FileCardSkeleton = ({ index = 0 }: { index?: number }) => {
    const baseDelay = index * 60;
    return (
        <View style={styles.card}>
            <SkeletonBlock width={46} height={46} borderRadius={13} delay={baseDelay} />
            <View style={styles.info}>
                <SkeletonBlock width="68%" height={14} borderRadius={7} delay={baseDelay + 30} />
                <View style={{ height: 7 }} />
                <SkeletonBlock width="42%" height={12} borderRadius={6} delay={baseDelay + 60} />
            </View>
        </View>
    );
};

export const FolderCardSkeleton = ({ index = 0 }: { index?: number }) => {
    const { isDark } = useTheme();
    const baseDelay = index * 80;
    const cardBg = isDark ? 'rgba(255,255,255,0.04)' : '#fff';
    const borderColor = isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9';
    return (
        <View style={[styles.folderCard, { backgroundColor: cardBg, borderColor }]}>
            <SkeletonBlock width={46} height={46} borderRadius={13} style={{ marginBottom: 28 }} delay={baseDelay} />
            <SkeletonBlock width="75%" height={14} borderRadius={7} delay={baseDelay + 40} />
            <View style={{ height: 6 }} />
            <SkeletonBlock width="50%" height={11} borderRadius={6} delay={baseDelay + 80} />
        </View>
    );
};

export const StatCardSkeleton = ({ index = 0 }: { index?: number }) => {
    const { isDark } = useTheme();
    const baseDelay = index * 80;
    const cardBg = isDark ? 'rgba(255,255,255,0.04)' : '#fff';
    const borderColor = isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9';
    return (
        <View style={[styles.statCard, { backgroundColor: cardBg, borderColor }]}>
            <SkeletonBlock width={42} height={42} borderRadius={11} style={{ marginBottom: 14 }} delay={baseDelay} />
            <SkeletonBlock width="58%" height={22} borderRadius={8} style={{ marginBottom: 8 }} delay={baseDelay + 40} />
            <SkeletonBlock width="42%" height={12} borderRadius={6} delay={baseDelay + 80} />
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
