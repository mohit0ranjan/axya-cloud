import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView,
    TouchableOpacity, ActivityIndicator, Animated, ScrollView
} from 'react-native';
import { ArrowLeft, HardDrive, Image as ImageIcon, Video, FileText, Activity } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function StorageAnalyticsScreen({ navigation }: any) {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>({
        totalBytes: 0,
        imageBytes: 0,
        videoBytes: 0,
        docBytes: 0,
        otherBytes: 0,
    });

    const fadeAnim = new Animated.Value(0);

    useEffect(() => {
        fetchStats();
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }, []);

    const fetchStats = async () => {
        try {
            const res = await apiClient.get('/files/stats');
            if (res.data?.success) {
                // Mocking breakdown until backend supports it fully, or using if it exists
                const total = res.data.totalBytes || 0;
                setStats({
                    totalBytes: total,
                    imageBytes: res.data.imageBytes || total * 0.45,
                    videoBytes: res.data.videoBytes || total * 0.35,
                    docBytes: res.data.docBytes || total * 0.15,
                    otherBytes: res.data.otherBytes || total * 0.05,
                });
            }
        } catch {
            // keep zeros
        } finally {
            setLoading(false);
        }
    };

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
    };

    const TOTAL_QUOTA = 15 * 1024 * 1024 * 1024; // 15GB 
    const isOverQuota = stats.totalBytes > TOTAL_QUOTA;

    const BG_COLOR = isDark ? '#0A0A0F' : '#F9FBFF';
    const CARD_BG = isDark ? '#14141E' : '#FFFFFF';
    const TEXT_MAIN = isDark ? '#FFFFFF' : '#0F172A';
    const TEXT_SUB = isDark ? '#94A3B8' : '#64748B';
    const BORDER = isDark ? '#1F1F2E' : '#E2E8F0';

    const getPercent = (val: number) => {
        if (!stats.totalBytes) return 0;
        return (val / stats.totalBytes) * 100;
    };

    return (
        <SafeAreaView style={[st.root, { backgroundColor: BG_COLOR }]}>
            <View style={[st.header, { backgroundColor: BG_COLOR, paddingTop: Math.max(insets.top + 8, 16) }]}>
                <TouchableOpacity style={st.headerBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
                    <ArrowLeft color={TEXT_MAIN} size={24} strokeWidth={2.5} />
                </TouchableOpacity>
                <Text style={[st.headerTitle, { color: TEXT_MAIN }]}>Storage Analytics</Text>
                <View style={{ width: 44 }} />
            </View>

            {loading ? (
                <View style={st.loaderView}>
                    <ActivityIndicator size="large" color="#4B6EF5" />
                </View>
            ) : (
                <Animated.ScrollView contentContainerStyle={st.scroll} style={{ opacity: fadeAnim }} showsVerticalScrollIndicator={false}>
                    
                    {/* TOTAL USAGE CARD */}
                    <View style={[st.card, { backgroundColor: CARD_BG, borderColor: BORDER }]}>
                        <View style={st.cardHeaderRow}>
                            <View style={[st.iconBox, { backgroundColor: 'rgba(75, 110, 245, 0.1)' }]}>
                                <HardDrive color="#4B6EF5" size={22} />
                            </View>
                            <Text style={[st.cardLabel, { color: TEXT_SUB }]}>Total Used</Text>
                        </View>
                        <Text style={[st.totalText, { color: isOverQuota ? '#EF4444' : TEXT_MAIN }]}>
                            {formatBytes(stats.totalBytes)}
                        </Text>
                        <Text style={[st.quotaText, { color: TEXT_SUB }]}>of 15 GB available</Text>
                        
                        {/* PROGRESS BAR */}
                        <View style={st.barTrack}>
                            <View style={[st.barFill, st.barImages, { width: `${getPercent(stats.imageBytes)}%` }]} />
                            <View style={[st.barFill, st.barVideos, { width: `${getPercent(stats.videoBytes)}%` }]} />
                            <View style={[st.barFill, st.barDocs, { width: `${getPercent(stats.docBytes)}%` }]} />
                            <View style={[st.barFill, st.barOther, { width: `${getPercent(stats.otherBytes)}%` }]} />
                        </View>
                    </View>

                    {/* BREAKDOWN LIST */}
                    <Text style={[st.sectionTitle, { color: TEXT_SUB }]}>BREAKDOWN</Text>
                    <View style={[st.listCard, { backgroundColor: CARD_BG, borderColor: BORDER }]}>
                        <ItemRow icon={<ImageIcon color="#4B6EF5" size={20}/>} color="rgba(75, 110, 245, 0.1)" title="Images" size={formatBytes(stats.imageBytes)} percent={getPercent(stats.imageBytes)} textColor={TEXT_MAIN} subColor={TEXT_SUB} />
                        <View style={[st.divider, { backgroundColor: BORDER }]} />
                        <ItemRow icon={<Video color="#10B981" size={20}/>} color="rgba(16, 185, 129, 0.1)" title="Videos" size={formatBytes(stats.videoBytes)} percent={getPercent(stats.videoBytes)} textColor={TEXT_MAIN} subColor={TEXT_SUB} />
                        <View style={[st.divider, { backgroundColor: BORDER }]} />
                        <ItemRow icon={<FileText color="#F59E0B" size={20}/>} color="rgba(245, 158, 11, 0.1)" title="Documents" size={formatBytes(stats.docBytes)} percent={getPercent(stats.docBytes)} textColor={TEXT_MAIN} subColor={TEXT_SUB} />
                        <View style={[st.divider, { backgroundColor: BORDER }]} />
                        <ItemRow icon={<HardDrive color="#8B5CF6" size={20}/>} color="rgba(139, 92, 246, 0.1)" title="Other files" size={formatBytes(stats.otherBytes)} percent={getPercent(stats.otherBytes)} textColor={TEXT_MAIN} subColor={TEXT_SUB} isLast />
                    </View>

                    {/* ACTIVITY */}
                    <Text style={[st.sectionTitle, { color: TEXT_SUB, marginTop: 12 }]}>RECENT ACTIVITY</Text>
                    <View style={[st.listCard, { backgroundColor: CARD_BG, borderColor: BORDER, paddingVertical: 32, alignItems: 'center' }]}>
                        <View style={[st.iconBox, { width: 56, height: 56, borderRadius: 28, backgroundColor: isDark ? '#1C1C2A' : '#F8FAFC', marginBottom: 12 }]}>
                            <Activity color={TEXT_SUB} size={24} />
                        </View>
                        <Text style={[st.emptyTitle, { color: TEXT_MAIN }]}>No recent uploads</Text>
                        <Text style={[st.emptySub, { color: TEXT_SUB }]}>Your storage activity will appear here.</Text>
                    </View>
                    
                    <View style={{ height: 60 }} />
                </Animated.ScrollView>
            )}
        </SafeAreaView>
    );
}

function ItemRow({ icon, color, title, size, percent, textColor, subColor, isLast }: any) {
    return (
        <View style={[st.itemRow, isLast && { paddingBottom: 16 }]}>
            <View style={[st.itemIconBox, { backgroundColor: color }]}>
                {icon}
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[st.itemTitle, { color: textColor }]}>{title}</Text>
                <Text style={[st.itemSub, { color: subColor }]}>{size}</Text>
            </View>
            <Text style={[st.itemPercent, { color: textColor }]}>{percent.toFixed(1)}%</Text>
        </View>
    );
}

const st = StyleSheet.create({
    root: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 16, zIndex: 10,
    },
    headerBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
    headerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
    loaderView: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 8 },
    
    card: {
        borderRadius: 24, padding: 24, marginBottom: 24, borderWidth: 1,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.03, shadowRadius: 12, elevation: 2,
    },
    cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    iconBox: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    cardLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
    totalText: { fontSize: 42, fontWeight: '800', letterSpacing: -1, marginBottom: 4 },
    quotaText: { fontSize: 15, fontWeight: '500', marginBottom: 28 },
    
    barTrack: { height: 10, backgroundColor: '#F1F5F9', borderRadius: 5, flexDirection: 'row', overflow: 'hidden' },
    barFill: { height: '100%' },
    barImages: { backgroundColor: '#4B6EF5' },
    barVideos: { backgroundColor: '#10B981' },
    barDocs: { backgroundColor: '#F59E0B' },
    barOther: { backgroundColor: '#8B5CF6' },

    sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginLeft: 8, marginBottom: 12 },
    
    listCard: {
        borderRadius: 24, borderWidth: 1, marginBottom: 16,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.02, shadowRadius: 8, elevation: 1,
    },
    itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20 },
    itemIconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    itemTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
    itemSub: { fontSize: 14 },
    itemPercent: { fontSize: 16, fontWeight: '700' },
    divider: { height: 1, marginLeft: 74, marginRight: 20 },

    emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
    emptySub: { fontSize: 14, fontWeight: '500' },
});
