/**
 * ProfileScreen.tsx — Premium minimal profile & settings screen
 *
 * ✅ Large centered circular avatar
 * ✅ Clean vertical spacing (24–32px sections)
 * ✅ Soft card sections (borderRadius 20, light shadow, 20px padding)
 * ✅ Menu items: left icon, title, right chevron, subtle dividers
 * ✅ Separated logout section with red accent
 * ✅ Dark mode compatible via ThemeContext
 * ✅ Press scale micro-interactions (0.97)
 * ✅ Smooth fade-in on mount
 */

import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView,
    TouchableOpacity, Alert, Platform, Animated, Pressable,
} from 'react-native';
import {
    ArrowLeft, LogOut, Star,
    Trash2, ChevronRight, Activity, Shield,
    Settings, FolderOpen, BarChart2,
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { SkeletonBlock } from '../ui/Skeleton';

// ─── Action Icons for Activity ───────────────────────────────────────────────

const ACTION_ICONS: Record<string, string> = {
    upload: '⬆️', delete_permanent: '🗑️', trash: '🗂️',
    restore: '↩️', rename: '✏️', create_folder: '📁', move: '📦',
};

// ─── Pressable Row with scale micro-interaction ──────────────────────────────

function PressableRow({
    children,
    onPress,
    style,
    disabled,
}: {
    children: React.ReactNode;
    onPress?: () => void;
    style?: any;
    disabled?: boolean;
}) {
    const scale = useRef(new Animated.Value(1)).current;

    const onPressIn = () => {
        Animated.spring(scale, {
            toValue: 0.97,
            tension: 300,
            friction: 20,
            useNativeDriver: true,
        }).start();
    };

    const onPressOut = () => {
        Animated.spring(scale, {
            toValue: 1,
            tension: 300,
            friction: 20,
            useNativeDriver: true,
        }).start();
    };

    if (!onPress) {
        return <View style={style}>{children}</View>;
    }

    return (
        <Pressable
            onPress={onPress}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            disabled={disabled}
        >
            <Animated.View style={[style, { transform: [{ scale }] }]}>
                {children}
            </Animated.View>
        </Pressable>
    );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ProfileScreen({ navigation }: any) {
    const authCtx = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark } = useTheme();

    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>({});
    const [activity, setActivity] = useState<any[]>([]);

    // Fade-in animation
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(20)).current;

    useEffect(() => {
        fetchAll();
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
        ]).start();
    }, []);

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [statsRes, actRes] = await Promise.all([
                apiClient.get('/files/stats').catch(() => ({ data: { success: false } })),
                apiClient.get('/files/activity').catch(() => ({ data: { success: false } })),
            ]);
            if (statsRes.data?.success) setStats(statsRes.data);
            if (actRes.data?.success) setActivity(actRes.data.activity.slice(0, 20));
        } catch { } finally { setLoading(false); }
    };

    const handleLogout = useCallback(() => {
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: () => authCtx.logout() },
        ]);
    }, [authCtx]);

    const formatSize = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
    };

    const formatDate = (d: string) =>
        new Date(d).toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });

    const C = theme.colors;
    const userName = authCtx.user?.name || authCtx.user?.username || 'Axya User';
    const userPhone = authCtx.user?.phone || '';
    const avatarLetter = (userName[0] || '?').toUpperCase();

    return (
        <SafeAreaView style={[st.root, { backgroundColor: C.background }]}>
            {/* ── Header ── */}
            <View style={st.header}>
                <TouchableOpacity
                    style={[st.headerBtn, { backgroundColor: C.card }]}
                    onPress={() => navigation.goBack()}
                    activeOpacity={0.7}
                >
                    <ArrowLeft color={C.textHeading} size={20} />
                </TouchableOpacity>
                <Text style={[st.headerTitle, { color: C.textHeading }]}>Profile</Text>
                <View style={{ width: 40 }} />
            </View>

            <Animated.ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={st.scroll}
                style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
            >
                {/* ────────────────────────────────────────────────────────────
                    AVATAR + NAME SECTION
                ──────────────────────────────────────────────────────────── */}
                <View style={st.avatarSection}>
                    <View style={[st.avatarRing, { borderColor: isDark ? C.primary : '#D6DFFE' }]}>
                        <View style={[st.avatarCircle, { backgroundColor: C.primary }]}>
                            <Text style={st.avatarLetter}>{avatarLetter}</Text>
                        </View>
                    </View>

                    {loading ? (
                        <View style={{ alignItems: 'center', marginTop: 16 }}>
                            <SkeletonBlock width={140} height={18} borderRadius={8} />
                            <SkeletonBlock width={100} height={13} borderRadius={6} style={{ marginTop: 8 }} />
                        </View>
                    ) : (
                        <>
                            <Text style={[st.userName, { color: C.textHeading }]}>{userName}</Text>
                            <Text style={[st.userSub, { color: C.muted }]}>{userPhone}</Text>
                        </>
                    )}
                </View>

                {/* ────────────────────────────────────────────────────────────
                    STORAGE STATS
                ──────────────────────────────────────────────────────────── */}
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    <View style={st.statsRow}>
                        <StatItem
                            label="Files"
                            value={loading ? '—' : String(stats.totalFiles ?? 0)}
                            color={C.primary}
                        />
                        <View style={[st.statDivider, { backgroundColor: C.border }]} />
                        <StatItem
                            label="Storage"
                            value={loading ? '—' : formatSize(stats.totalBytes || 0)}
                            color={C.success}
                        />
                        <View style={[st.statDivider, { backgroundColor: C.border }]} />
                        <StatItem
                            label="Starred"
                            value={loading ? '—' : String(stats.starredCount ?? 0)}
                            color={C.accent}
                        />
                        <View style={[st.statDivider, { backgroundColor: C.border }]} />
                        <StatItem
                            label="Trash"
                            value={loading ? '—' : String(stats.trashCount ?? 0)}
                            color={C.danger}
                        />
                    </View>
                </View>

                {/* ────────────────────────────────────────────────────────────
                    QUICK ACCESS
                ──────────────────────────────────────────────────────────── */}
                <Text style={[st.sectionLabel, { color: C.muted }]}>QUICK ACCESS</Text>
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    <MenuItem
                        icon={<Star color="#F59E0B" size={20} />}
                        iconBg={isDark ? 'rgba(245,158,11,0.12)' : '#FEF3C7'}
                        title="Starred Files"
                        color={C.textHeading}
                        chevronColor={C.muted}
                        onPress={() => navigation.navigate('Starred')}
                    />
                    <View style={[st.rowDivider, { backgroundColor: C.border }]} />
                    <MenuItem
                        icon={<FolderOpen color={C.primary} size={20} />}
                        iconBg={isDark ? C.primaryLight : '#EEF1FD'}
                        title="All Folders"
                        color={C.textHeading}
                        chevronColor={C.muted}
                        onPress={() => navigation.navigate('Folders')}
                    />
                    <View style={[st.rowDivider, { backgroundColor: C.border }]} />
                    <MenuItem
                        icon={<Trash2 color={C.danger} size={20} />}
                        iconBg={isDark ? 'rgba(239,68,68,0.12)' : '#FEE2E2'}
                        title="Trash"
                        color={C.textHeading}
                        chevronColor={C.muted}
                        onPress={() => navigation.navigate('Trash')}
                    />
                    <View style={[st.rowDivider, { backgroundColor: C.border }]} />
                    <MenuItem
                        icon={<BarChart2 color="#8B5CF6" size={20} />}
                        iconBg={isDark ? 'rgba(139,92,246,0.12)' : '#EDE9FE'}
                        title="Storage Analytics"
                        color={C.textHeading}
                        chevronColor={C.muted}
                        onPress={() => navigation.navigate('Analytics')}
                    />
                </View>

                {/* ────────────────────────────────────────────────────────────
                    SETTINGS
                ──────────────────────────────────────────────────────────── */}
                <Text style={[st.sectionLabel, { color: C.muted }]}>SETTINGS</Text>
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    <MenuItem
                        icon={<Settings color={C.textBody} size={20} />}
                        iconBg={isDark ? 'rgba(100,116,139,0.12)' : '#F1F5F9'}
                        title="Preferences"
                        color={C.textHeading}
                        chevronColor={C.muted}
                        onPress={() => navigation.navigate('Settings')}
                    />
                    <View style={[st.rowDivider, { backgroundColor: C.border }]} />
                    <MenuItem
                        icon={<Shield color={C.primary} size={20} />}
                        iconBg={isDark ? C.primaryLight : '#EEF1FD'}
                        title="Security"
                        subtitle="End-to-end encrypted via Telegram"
                        color={C.textHeading}
                        chevronColor={C.muted}
                    />
                </View>

                {/* ────────────────────────────────────────────────────────────
                    RECENT ACTIVITY
                ──────────────────────────────────────────────────────────── */}
                <Text style={[st.sectionLabel, { color: C.muted }]}>RECENT ACTIVITY</Text>
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    {loading ? (
                        [1, 2, 3].map(i => (
                            <View key={i} style={st.actRow}>
                                <SkeletonBlock width={36} height={36} borderRadius={10} />
                                <View style={{ marginLeft: 14, flex: 1 }}>
                                    <SkeletonBlock width="65%" height={13} borderRadius={5} style={{ marginBottom: 6 }} />
                                    <SkeletonBlock width="40%" height={11} borderRadius={5} />
                                </View>
                            </View>
                        ))
                    ) : activity.length === 0 ? (
                        <View style={st.emptyState}>
                            <Activity color={C.muted} size={28} />
                            <Text style={[st.emptyText, { color: C.muted }]}>No recent activity</Text>
                        </View>
                    ) : (
                        activity.map((act, i) => (
                            <React.Fragment key={act.id}>
                                <View style={st.actRow}>
                                    <View style={[st.actIconBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC' }]}>
                                        <Text style={{ fontSize: 16 }}>
                                            {ACTION_ICONS[act.action] || '📄'}
                                        </Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[st.actTitle, { color: C.textHeading }]} numberOfLines={1}>
                                            {act.action.replace(/_/g, ' ')}{act.file_name ? `: ${act.file_name}` : ''}
                                        </Text>
                                        <Text style={[st.actDate, { color: C.muted }]}>{formatDate(act.created_at)}</Text>
                                    </View>
                                </View>
                                {i < activity.length - 1 && (
                                    <View style={[st.rowDivider, { backgroundColor: C.border }]} />
                                )}
                            </React.Fragment>
                        ))
                    )}
                </View>

                {/* ────────────────────────────────────────────────────────────
                    SIGN OUT
                ──────────────────────────────────────────────────────────── */}
                <PressableRow
                    onPress={handleLogout}
                    style={[st.logoutCard, {
                        backgroundColor: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)',
                    }]}
                >
                    <LogOut color={C.danger} size={20} />
                    <Text style={[st.logoutText, { color: C.danger }]}>Sign Out</Text>
                </PressableRow>

                <Text style={[st.footerText, { color: C.muted }]}>
                    Axya Cloud v1.0.0
                </Text>

                <View style={{ height: 40 }} />
            </Animated.ScrollView>
        </SafeAreaView>
    );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatItem({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <View style={st.statItem}>
            <Text style={[st.statValue, { color }]}>{value}</Text>
            <Text style={[st.statLabel]}>{label}</Text>
        </View>
    );
}

function MenuItem({
    icon, iconBg, title, subtitle, color, chevronColor, onPress,
}: {
    icon: React.ReactNode;
    iconBg: string;
    title: string;
    subtitle?: string;
    color: string;
    chevronColor: string;
    onPress?: () => void;
}) {
    return (
        <PressableRow onPress={onPress} style={st.menuRow}>
            <View style={[st.menuIconBox, { backgroundColor: iconBg }]}>
                {icon}
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[st.menuTitle, { color }]}>{title}</Text>
                {subtitle && <Text style={[st.menuSub, { color: chevronColor }]}>{subtitle}</Text>}
            </View>
            {onPress && <ChevronRight color={chevronColor} size={18} />}
        </PressableRow>
    );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'web' ? 44 : 16,
        paddingBottom: 8,
    },
    headerBtn: {
        width: 40,
        height: 40,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6 },
            android: { elevation: 2 },
        }),
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '700',
        letterSpacing: -0.3,
    },
    scroll: {
        paddingHorizontal: 20,
        paddingTop: 8,
    },

    // ── Avatar Section ───────────────────────────────────────────────────────
    avatarSection: {
        alignItems: 'center',
        paddingVertical: 28,
    },
    avatarRing: {
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 3,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarCircle: {
        width: 86,
        height: 86,
        borderRadius: 43,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarLetter: {
        color: '#fff',
        fontSize: 34,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    userName: {
        fontSize: 22,
        fontWeight: '800',
        letterSpacing: -0.4,
        marginTop: 16,
    },
    userSub: {
        fontSize: 14,
        fontWeight: '500',
        marginTop: 4,
        letterSpacing: 0.2,
    },

    // ── Card base ────────────────────────────────────────────────────────────
    card: {
        borderRadius: 20,
        marginBottom: 24,
        overflow: 'hidden',
    },

    // ── Section labels ───────────────────────────────────────────────────────
    sectionLabel: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.2,
        marginBottom: 10,
        marginTop: 4,
        paddingLeft: 4,
        textTransform: 'uppercase',
    },

    // ── Stats row ────────────────────────────────────────────────────────────
    statsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 20,
        paddingHorizontal: 8,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
        gap: 4,
    },
    statValue: {
        fontSize: 20,
        fontWeight: '600',
    },
    statLabel: {
        fontSize: 12,
        fontWeight: '500',
        color: '#94A3B8',
        marginTop: 4,
    },
    statDivider: {
        width: 1,
        height: 32,
        opacity: 0.6,
    },

    // ── Menu rows ────────────────────────────────────────────────────────────
    menuRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 14,
    },
    menuIconBox: {
        width: 38,
        height: 38,
        borderRadius: 11,
        justifyContent: 'center',
        alignItems: 'center',
    },
    menuTitle: {
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: -0.1,
    },
    menuSub: {
        fontSize: 12,
        marginTop: 2,
    },
    rowDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 68,
    },

    // ── Activity ─────────────────────────────────────────────────────────────
    actRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 13,
        gap: 14,
    },
    actIconBox: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    actTitle: {
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'capitalize',
        marginBottom: 2,
    },
    actDate: {
        fontSize: 11,
        fontWeight: '500',
    },

    emptyState: {
        paddingVertical: 32,
        alignItems: 'center',
        gap: 8,
    },
    emptyText: {
        fontSize: 13,
        fontWeight: '600',
    },

    // ── Logout ───────────────────────────────────────────────────────────────
    logoutCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        height: 52,
        borderRadius: 16,
        marginBottom: 16,
        marginTop: 4,
    },
    logoutText: {
        fontSize: 15,
        fontWeight: '700',
    },

    // ── Footer ───────────────────────────────────────────────────────────────
    footerText: {
        textAlign: 'center',
        fontSize: 11,
        fontWeight: '500',
        marginBottom: 8,
    },
});
