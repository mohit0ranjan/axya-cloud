import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView,
    TouchableOpacity, Alert, Platform, Animated, Pressable,
} from 'react-native';
import {
    ArrowLeft, LogOut, Star,
    Trash2, ChevronRight, Activity, Shield,
    Settings, FolderOpen, BarChart2, HardDrive,
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { SkeletonBlock } from '../ui/Skeleton';
import Constants from 'expo-constants';

const ACTION_ICONS: Record<string, string> = {
    upload: 'UP',
    delete_permanent: 'DEL',
    trash: 'TR',
    restore: 'RE',
    rename: 'RN',
    create_folder: 'FD',
    move: 'MV',
};

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
            toValue: 0.98,
            tension: 280,
            friction: 20,
            useNativeDriver: true,
        }).start();
    };

    const onPressOut = () => {
        Animated.spring(scale, {
            toValue: 1,
            tension: 280,
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

export default function ProfileScreen({ navigation }: any) {
    const authCtx = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark } = useTheme();

    const [loading, setLoading] = useState(true);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [stats, setStats] = useState<any>({});
    const [activity, setActivity] = useState<any[]>([]);
    const appVersion = Constants.expoConfig?.version || 'dev';

    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(20)).current;

    useEffect(() => {
        fetchAll();
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
            Animated.timing(slideAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
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
        } catch {
            // keep previous values
        } finally {
            setLoading(false);
        }
    };

    const confirmLogout = useCallback(async () => {
        if (isSigningOut) return;
        setIsSigningOut(true);
        try {
            await authCtx?.logout?.();
        } catch {
            showToast('Sign out failed', 'error');
        } finally {
            setIsSigningOut(false);
        }
    }, [authCtx, isSigningOut, showToast]);

    const handleLogout = useCallback(() => {
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: () => { void confirmLogout(); } },
        ]);
    }, [confirmLogout]);

    const formatStorageSplit = (bytes: number): { value: string; unit: string } => {
        if (!bytes) return { value: '0', unit: 'B' };
        const mb = bytes / (1024 * 1024);
        if (mb >= 1024) {
            const gb = mb / 1024;
            return { value: gb >= 10 ? Math.round(gb).toString() : gb.toFixed(1), unit: 'GB' };
        }
        return { value: Math.round(mb).toString(), unit: 'MB' };
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

    const storage = loading ? { value: '-', unit: '' } : formatStorageSplit(stats.totalBytes || 0);
    const handleBack = () => {
        if (navigation?.canGoBack?.()) {
            navigation.goBack();
            return;
        }
        navigation?.navigate?.('MainTabs', { screen: 'Home' });
    };

    return (
        <SafeAreaView style={[st.root, { backgroundColor: C.background }]}>
            <View style={st.header}>
                <TouchableOpacity
                    style={[st.headerBtn, { backgroundColor: C.card }]}
                    onPress={handleBack}
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
                <View
                    style={[
                        st.profileCard,
                        {
                            backgroundColor: C.card,
                            borderColor: C.border,
                        },
                        theme.shadows.card,
                    ]}
                >
                    <View style={st.profileTopRow}>
                        <View style={[st.avatarRing, { borderColor: isDark ? C.primary : '#D6DFFE' }]}>
                            <View style={[st.avatarCircle, { backgroundColor: C.primary }]}>
                                <Text style={st.avatarLetter}>{avatarLetter}</Text>
                            </View>
                        </View>

                        {loading ? (
                            <View style={{ marginLeft: 14, flex: 1 }}>
                                <SkeletonBlock width={160} height={18} borderRadius={8} />
                                <SkeletonBlock width={120} height={13} borderRadius={6} style={{ marginTop: 8 }} />
                            </View>
                        ) : (
                            <View style={st.profileInfoCol}>
                                <Text style={[st.userName, { color: C.textHeading }]} numberOfLines={1}>{userName}</Text>
                                <Text style={[st.userSub, { color: C.muted }]} numberOfLines={1}>
                                    {userPhone || 'No phone linked'}
                                </Text>
                                <View style={[st.accountBadge, { backgroundColor: isDark ? C.primaryLight : '#EEF1FD' }]}>
                                    <Text style={[st.accountBadgeText, { color: C.primary }]}>Personal Workspace</Text>
                                </View>
                            </View>
                        )}
                    </View>
                </View>

                <View style={st.statsGrid}>
                    <StatTile
                        label="Files"
                        value={loading ? '-' : String(stats.totalFiles ?? 0)}
                        color={C.primary}
                        bg={isDark ? 'rgba(88,117,255,0.12)' : '#EEF2FF'}
                        labelColor={isDark ? '#9CB4FF' : '#4A63E6'}
                        icon={<FolderOpen color={isDark ? '#9CB4FF' : '#4A63E6'} size={16} />}
                        onPress={() => navigation.navigate('Files')}
                    />
                    <StatTile
                        label="Storage Used"
                        value={storage.value}
                        unit={storage.unit}
                        color={C.textHeading}
                        bg={isDark ? 'rgba(148,163,184,0.12)' : '#F1F5F9'}
                        labelColor={isDark ? '#A8B9CF' : '#5C728F'}
                        icon={<HardDrive color={isDark ? '#A8B9CF' : '#5C728F'} size={16} />}
                        onPress={() => navigation.navigate('Analytics')}
                    />
                    <StatTile
                        label="Starred"
                        value={loading ? '-' : String(stats.starredCount ?? 0)}
                        color={C.accent}
                        bg={isDark ? 'rgba(245,158,11,0.12)' : '#FFFBEB'}
                        labelColor={isDark ? '#F5C56A' : '#C18A00'}
                        icon={<Star color={isDark ? '#F5C56A' : '#C18A00'} size={16} />}
                        onPress={() => navigation.navigate('Starred')}
                    />
                    <StatTile
                        label="Trash"
                        value={loading ? '-' : String(stats.trashCount ?? 0)}
                        color={C.danger}
                        bg={isDark ? 'rgba(239,68,68,0.12)' : '#FEF2F2'}
                        labelColor={isDark ? '#FF9C9C' : '#CF3A3A'}
                        icon={<Trash2 color={isDark ? '#FF9C9C' : '#CF3A3A'} size={16} />}
                        onPress={() => navigation.navigate('Trash')}
                    />
                </View>

                <Text style={[st.sectionLabel, { color: C.muted }]}>Quick Access</Text>
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

                <Text style={[st.sectionLabel, { color: C.muted }]}>Settings</Text>
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
                        onPress={() => navigation.navigate('Settings')}
                    />
                </View>

                <Text style={[st.sectionLabel, { color: C.muted }]}>Recent Activity</Text>
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    {loading ? (
                        [1, 2, 3].map(i => (
                            <View key={i} style={st.actRow}>
                                <SkeletonBlock width={34} height={34} borderRadius={10} />
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
                                            {ACTION_ICONS[act.action] || 'FI'}
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

                <TouchableOpacity
                    onPress={handleLogout}
                    activeOpacity={0.85}
                    disabled={isSigningOut}
                    style={[
                        st.logoutCard,
                        {
                            backgroundColor: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)',
                            opacity: isSigningOut ? 0.65 : 1,
                        },
                    ]}
                >
                    <LogOut color={C.danger} size={20} />
                    <Text style={[st.logoutText, { color: C.danger }]}>
                        {isSigningOut ? 'Signing out...' : 'Sign Out'}
                    </Text>
                </TouchableOpacity>

                <Text style={[st.footerText, { color: C.muted }]}>Axya Cloud v{appVersion}</Text>
            </Animated.ScrollView>
        </SafeAreaView>
    );
}

function StatTile({
    label,
    value,
    unit,
    color,
    bg,
    labelColor,
    icon,
    onPress,
}: {
    label: string;
    value: string;
    unit?: string;
    color: string;
    bg: string;
    labelColor?: string;
    icon?: React.ReactNode;
    onPress?: () => void;
}) {
    return (
        <PressableRow onPress={onPress} style={[st.statTile, { backgroundColor: bg }]}>
            <View style={st.statRow}>
                {icon ? <View style={[st.statIconWrap, { backgroundColor: color + '18' }]}>{icon}</View> : null}
                <View style={st.statTextCol}>
                    <View style={st.statValueRow}>
                        <Text style={[st.statValue, { color }]} numberOfLines={1}>{value}</Text>
                        {unit ? <Text style={[st.statUnit, { color }]}>{unit}</Text> : null}
                    </View>
                    <Text style={[st.statLabel, labelColor ? { color: labelColor } : null]} numberOfLines={1}>{label}</Text>
                </View>
            </View>
        </PressableRow>
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
        paddingBottom: 12,
    },
    headerBtn: {
        width: 44,
        height: 44,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6 },
            android: { elevation: 2 },
        }),
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        letterSpacing: -0.3,
    },
    scroll: {
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 24,
    },

    profileCard: {
        borderRadius: 20,
        borderWidth: 1,
        paddingHorizontal: 20,
        paddingVertical: 20,
        marginBottom: 20,
    },
    profileTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    profileInfoCol: {
        marginLeft: 16,
        flex: 1,
    },
    avatarRing: {
        width: 76,
        height: 76,
        borderRadius: 38,
        borderWidth: 3,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarLetter: {
        color: '#fff',
        fontSize: 26,
        fontWeight: '700',
    },
    userName: {
        fontSize: 20,
        fontWeight: '600',
        letterSpacing: -0.3,
        fontFamily: Platform.select({
            ios: 'Avenir Next',
            android: 'sans-serif-medium',
            default: undefined,
        }),
    },
    userSub: {
        fontSize: 14,
        fontWeight: '500',
        marginTop: 4,
        letterSpacing: 0.1,
    },
    accountBadge: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginTop: 10,
    },
    accountBadgeText: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.2,
    },

    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 24,
    },
    statTile: {
        flex: 1,
        minWidth: '45%',
        borderRadius: 16,
        paddingVertical: 16,
        paddingHorizontal: 16,
    },
    statRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    statTextCol: {
        flex: 1,
    },
    statValueRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 4,
    },
    statValue: {
        fontSize: 24,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    statUnit: {
        fontSize: 14,
        fontWeight: '600',
    },
    statLabel: {
        fontSize: 12,
        fontWeight: '500',
        color: '#94A3B8',
        marginTop: 4,
    },
    statIconWrap: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },

    card: {
        borderRadius: 20,
        marginBottom: 20,
        overflow: 'hidden',
    },
    sectionLabel: {
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: 0.3,
        marginBottom: 10,
        paddingLeft: 2,
        textTransform: 'uppercase',
    },

    menuRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 16,
        gap: 14,
    },
    menuIconBox: {
        width: 42,
        height: 42,
        borderRadius: 12,
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
        marginTop: 3,
        fontWeight: '500',
    },
    rowDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 72,
    },

    actRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 14,
    },
    actIconBox: {
        width: 40,
        height: 40,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    actTitle: {
        fontSize: 14,
        fontWeight: '600',
        textTransform: 'capitalize',
        marginBottom: 2,
    },
    actDate: {
        fontSize: 12,
        fontWeight: '500',
    },
    emptyState: {
        paddingVertical: 32,
        alignItems: 'center',
        gap: 10,
    },
    emptyText: {
        fontSize: 14,
        fontWeight: '600',
    },

    logoutCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        height: 54,
        borderRadius: 16,
        marginBottom: 16,
        marginTop: 8,
    },
    logoutText: {
        fontSize: 15,
        fontWeight: '600',
    },

    footerText: {
        textAlign: 'center',
        fontSize: 12,
        fontWeight: '500',
        marginBottom: 12,
    },
});
