import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, ScrollView,
    TouchableOpacity, RefreshControl, Dimensions, Platform
} from 'react-native';
import {
    ArrowLeft, MoreHorizontal, HardDrive, Image as ImageIcon,
    Film, Music, FileText, Archive, Folder, Star, Trash2, CheckCircle2, AlertTriangle, Info
} from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { useTheme } from '../context/ThemeContext';
import { formatSize, formatPct } from '../utils/format';
import { SkeletonBlock } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import Svg, { Circle, G, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

const { width } = Dimensions.get('window');

const CATEGORIES = [
    { key: 'image', label: 'Images', color: '#FF5A1F', icon: ImageIcon },
    { key: 'video', label: 'Videos', color: '#3B82F6', icon: Film },
    { key: 'pdf', label: 'Documents', color: '#10B981', icon: FileText },
    { key: 'audio', label: 'Audio', color: '#F59E0B', icon: Music },
    { key: 'archive', label: 'Archives', color: '#EC4899', icon: Archive },
    { key: 'other', label: 'Others', color: '#8B5CF6', icon: HardDrive },
];

function CircularProgress({ usedGB, isUnlimited, themeColors, isDark }: any) {
    const size = 120;
    const strokeWidth = 12;
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    
    // For unlimited, we'll cap the visual progress to 50GB for the circle animation
    // Or just show a cool "breathing" full circle for unlimited power users.
    const percentage = isUnlimited ? Math.min((usedGB / 50) * 100, 100) : 50; 
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    return (
        <View style={st.circularContainer}>
            <Svg width={size} height={size}>
                <Defs>
                    <SvgLinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <Stop offset="0%" stopColor="#FF5A1F" />
                        <Stop offset="100%" stopColor="#FFA07A" />
                    </SvgLinearGradient>
                </Defs>
                <G rotation={-90} originX={size / 2} originY={size / 2}>
                    <Circle
                        cx={size / 2} cy={size / 2} r={radius}
                        stroke={isDark ? '#1E293B' : '#F1F5F9'}
                        strokeWidth={strokeWidth} fill="transparent"
                    />
                    <Circle
                        cx={size / 2} cy={size / 2} r={radius}
                        stroke="url(#gradient)"
                        strokeWidth={strokeWidth} fill="transparent"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                    />
                </G>
            </Svg>
            <View style={st.circularLabelWrap}>
                {isUnlimited ? (
                    <>
                        <Text style={[st.circularLabelValue, { color: themeColors.textHeading }]}>∞</Text>
                        <Text style={[st.circularLabelSub, { color: themeColors.primary }]}>Unlimited</Text>
                    </>
                ) : (
                    <>
                        <Text style={[st.circularLabelValue, { color: themeColors.textHeading }]}>{percentage.toFixed(0)}%</Text>
                        <Text style={[st.circularLabelSub, { color: themeColors.textBody }]}>Used</Text>
                    </>
                )}
            </View>
        </View>
    );
}

export default function AnalyticsScreen({ navigation }: any) {
    const { theme, isDark } = useTheme();
    const C = theme.colors;

    // Tokens matching the requested minimal premium palette
    const BG_COLOR = isDark ? '#0A0A0A' : '#FFFFFF';
    const CARD_BG = isDark ? '#141414' : '#F5F7FB';
    const BORDER = isDark ? '#262626' : '#E2E8F0';
    const TEXT_MAIN = isDark ? '#F8FAFC' : '#0F172A';
    const TEXT_SUB = isDark ? '#94A3B8' : '#64748B';
    const PRIMARY_ACCENT = '#FF5A1F'; 

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState<any>({});

    const loadData = useCallback(async () => {
        try {
            const res = await apiClient.get('/files/stats');
            if (res.data?.success) setStats(res.data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const byType: Record<string, { count: number; bytes: number }> = {};
    (stats.storageByType || []).forEach((row: any) => {
        byType[row.category] = { count: row.count, bytes: parseInt(row.bytes) };
    });

    const totalBytes = stats.totalBytes || 0;
    const usedGB = totalBytes / (1024 ** 3);

    const chartData = useMemo(() => {
        return CATEGORIES.map(cat => ({
            ...cat,
            bytes: byType[cat.key]?.bytes || 0,
            count: byType[cat.key]?.count || 0,
        })).filter(d => d.bytes > 0).sort((a, b) => b.bytes - a.bytes); // Sort by highest usage
    }, [stats]);

    // Derived Health Message
    const getHealthState = () => {
        if (usedGB < 5) return { msg: "You're using storage efficiently", color: '#10B981', icon: CheckCircle2 };
        if (usedGB < 20) return { msg: "Your storage is healthy", color: '#3B82F6', icon: Info };
        return { msg: "Action needed - consider cleanup", color: '#F59E0B', icon: AlertTriangle };
    };
    const health = getHealthState();
    const HealthIcon = health.icon;

    return (
        <SafeAreaView style={[st.root, { backgroundColor: BG_COLOR }]}>
            {/* 1. HEADER */}
            <View style={[st.header, { backgroundColor: BG_COLOR }]}>
                <TouchableOpacity style={st.iconBtn} onPress={() => navigation?.goBack()}>
                    <ArrowLeft color={TEXT_MAIN} size={24} />
                </TouchableOpacity>
                <Text style={[st.headerTitle, { color: TEXT_MAIN }]}>Storage Analytics</Text>
                <TouchableOpacity style={st.iconBtn}>
                    <MoreHorizontal color={TEXT_MAIN} size={24} />
                </TouchableOpacity>
            </View>

            <ScrollView 
                showsVerticalScrollIndicator={false} 
                contentContainerStyle={st.scroll}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadData(); }} tintColor={PRIMARY_ACCENT} />}
            >
                {loading ? (
                    <View style={{ gap: 20 }}>
                        <SkeletonBlock width="100%" height={240} borderRadius={24} />
                        <View style={{ flexDirection: 'row', gap: 12 }}><SkeletonBlock width="48%" height={100} borderRadius={24} /><SkeletonBlock width="48%" height={100} borderRadius={24} /></View>
                        <SkeletonBlock width="100%" height={300} borderRadius={24} />
                    </View>
                ) : (
                    <>
                        {/* 2. STORAGE OVERVIEW CARD */}
                        <View style={[st.card, { backgroundColor: CARD_BG, borderColor: BORDER }]}>
                            <Text style={[st.cardTitle, { color: TEXT_MAIN }]}>Overview</Text>
                            
                            <View style={st.overviewRow}>
                                <View style={st.overviewTextWrap}>
                                    <Text style={[st.overviewLabel, { color: TEXT_SUB }]}>Total Used</Text>
                                    <Text style={[st.overviewValue, { color: TEXT_MAIN }]}>{formatSize(totalBytes)}</Text>
                                    <View style={st.unlimitedBadge}>
                                        <Text style={st.unlimitedText}>Unlimited Plan</Text>
                                    </View>
                                </View>
                                <CircularProgress usedGB={usedGB} isUnlimited={true} themeColors={C} isDark={isDark} />
                            </View>

                            {/* 4. HEALTH MESSAGE */}
                            <View style={[st.healthBox, { backgroundColor: isDark ? '#1E293B' : '#EFF6FF' }]}>
                                <HealthIcon color={health.color} size={18} />
                                <Text style={[st.healthText, { color: TEXT_MAIN }]}>{health.msg}</Text>
                            </View>

                            {/* 3. STORAGE BAR (COMPOSITION) */}
                            <Text style={[st.cardTitle, { color: TEXT_MAIN, marginTop: 24, marginBottom: 12, fontSize: 14 }]}>Composition</Text>
                            <View style={[st.stackedBarTrack, { backgroundColor: isDark ? '#262626' : '#E2E8F0' }]}>
                                {totalBytes === 0 ? (
                                    <View style={[st.stackedBarSegment, { backgroundColor: BORDER, width: '100%' }]} />
                                ) : (
                                    chartData.map((d, idx) => (
                                        <View 
                                            key={idx} 
                                            style={[st.stackedBarSegment, { 
                                                backgroundColor: d.color, 
                                                width: `${(d.bytes / totalBytes) * 100}%`,
                                                borderTopLeftRadius: idx === 0 ? 8 : 0,
                                                borderBottomLeftRadius: idx === 0 ? 8 : 0,
                                                borderTopRightRadius: idx === chartData.length - 1 ? 8 : 0,
                                                borderBottomRightRadius: idx === chartData.length - 1 ? 8 : 0,
                                            }]} 
                                        />
                                    ))
                                )}
                            </View>
                        </View>

                        {/* 5. STATS GRID */}
                        <View style={st.statsGrid}>
                            {[
                                { label: 'Files', value: stats.totalFiles ?? 0, icon: FileText, color: '#3B82F6', nav: 'AllFiles' },
                                { label: 'Folders', value: stats.totalFolders ?? 0, icon: Folder, color: '#10B981', nav: 'Folders' },
                                { label: 'Starred', value: stats.starredCount ?? 0, icon: Star, color: '#F59E0B', nav: 'Starred' },
                                { label: 'Trash', value: stats.trashCount ?? 0, icon: Trash2, color: '#EF4444', nav: 'Trash' },
                            ].map((s, i) => {
                                const IconNode = s.icon;
                                return (
                                    <TouchableOpacity 
                                        key={i} 
                                        style={[st.statCard, { backgroundColor: CARD_BG, borderColor: BORDER }]}
                                        activeOpacity={0.7}
                                        onPress={() => navigation?.navigate(s.nav)}
                                    >
                                        <View style={[st.statIconBox, { backgroundColor: `${s.color}15` }]}>
                                            <IconNode color={s.color} size={20} />
                                        </View>
                                        <Text style={[st.statVal, { color: TEXT_MAIN }]}>{s.value}</Text>
                                        <Text style={[st.statLabel, { color: TEXT_SUB }]}>{s.label}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        {/* 6. COMPOSITION BREAKDOWN LIST */}
                        <View style={[st.card, { backgroundColor: CARD_BG, borderColor: BORDER, marginBottom: 120 }]}>
                            <Text style={[st.cardTitle, { color: TEXT_MAIN, marginBottom: 16 }]}>Detailed Breakdown</Text>
                            
                            {chartData.map((d, index) => {
                                const pct = totalBytes > 0 ? ((d.bytes / totalBytes) * 100).toFixed(1) : '0';
                                const CatIcon = d.icon;
                                return (
                                    <View key={d.key}>
                                        <TouchableOpacity style={st.breakdownRow} activeOpacity={0.7}>
                                            <View style={st.breakdownRowLeft}>
                                                <View style={[st.catIconBox, { backgroundColor: `${d.color}15` }]}>
                                                    <CatIcon color={d.color} size={18} />
                                                </View>
                                                <View>
                                                    <Text style={[st.breakdownText, { color: TEXT_MAIN }]}>{d.label}</Text>
                                                    <Text style={[st.breakdownCount, { color: TEXT_SUB }]}>{d.count} files</Text>
                                                </View>
                                            </View>
                                            <View style={st.breakdownRowRight}>
                                                <Text style={[st.breakdownSize, { color: TEXT_MAIN }]}>{formatSize(d.bytes)}</Text>
                                                <Text style={[st.breakdownPct, { backgroundColor: isDark ? '#262626' : '#E2E8F0', color: TEXT_SUB }]}>{pct}%</Text>
                                            </View>
                                        </TouchableOpacity>
                                        {index < chartData.length - 1 && <View style={[st.breakdownDivider, { backgroundColor: BORDER }]} />}
                                    </View>
                                );
                            })}

                            {chartData.length === 0 && (
                                <EmptyState
                                    title="No Data"
                                    description="Your storage is completely empty."
                                    iconType="file"
                                    style={{ paddingVertical: 20, flex: 0 }}
                                />
                            )}
                        </View>
                    </>
                )}
            </ScrollView>

        </SafeAreaView>
    );
}

const st = StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, zIndex: 10 },
    iconBtn: { padding: 8 },
    headerTitle: { fontSize: 20, fontWeight: '700', letterSpacing: 0.2 },
    scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },

    card: { borderRadius: 24, padding: 20, marginBottom: 20, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 10, elevation: 2 },
    cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 20 },
    
    overviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    overviewTextWrap: { flex: 1 },
    overviewLabel: { fontSize: 14, fontWeight: '500', marginBottom: 4 },
    overviewValue: { fontSize: 34, fontWeight: '800', marginBottom: 8, letterSpacing: 0.1 },
    unlimitedBadge: { alignSelf: 'flex-start', backgroundColor: '#FF5A1F15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    unlimitedText: { color: '#FF5A1F', fontSize: 12, fontWeight: '600' },

    circularContainer: { width: 120, height: 120, justifyContent: 'center', alignItems: 'center' },
    circularLabelWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
    circularLabelValue: { fontSize: 24, fontWeight: '800', marginBottom: -2 },
    circularLabelSub: { fontSize: 11, fontWeight: '600' },

    healthBox: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, gap: 10 },
    healthText: { fontSize: 14, fontWeight: '500', flex: 1 },

    stackedBarTrack: { height: 16, borderRadius: 8, flexDirection: 'row', width: '100%', overflow: 'hidden' },
    stackedBarSegment: { height: '100%' },

    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
    statCard: { width: '48%', borderRadius: 20, padding: 16, borderWidth: 1 },
    statIconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
    statVal: { fontSize: 34, fontWeight: '700', marginBottom: 2, letterSpacing: 0.1 },
    statLabel: { fontSize: 14, fontWeight: '500' },

    breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
    breakdownRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    catIconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    breakdownText: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
    breakdownCount: { fontSize: 12, fontWeight: '500' },
    breakdownRowRight: { alignItems: 'flex-end', gap: 6 },
    breakdownSize: { fontSize: 15, fontWeight: '700' },
    breakdownPct: { fontSize: 12, fontWeight: '600', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
    breakdownDivider: { height: StyleSheet.hairlineWidth, marginLeft: 54 },
});
