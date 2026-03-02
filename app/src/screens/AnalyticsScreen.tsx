import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, ScrollView,
    TouchableOpacity, ActivityIndicator, Dimensions,
} from 'react-native';
import { ArrowLeft, HardDrive, FileText, Image as ImageIcon, Film, Music, Archive } from 'lucide-react-native';
import Svg, { G, Circle, Path } from 'react-native-svg';
import apiClient from '../services/apiClient';
import { useTheme } from '../context/ThemeContext';
import { formatSize, formatPct } from '../utils/format';

const { width } = Dimensions.get('window');

const CATEGORIES = [
    { key: 'image', label: 'Images', color: '#F59E0B', icon: ImageIcon },
    { key: 'video', label: 'Videos', color: '#9333EA', icon: Film },
    { key: 'audio', label: 'Audio', color: '#1FD45A', icon: Music },
    { key: 'pdf', label: 'Documents', color: '#EF4444', icon: FileText },
    { key: 'archive', label: 'Archives', color: '#F97316', icon: Archive },
    { key: 'other', label: 'Other', color: '#64748B', icon: HardDrive },
];

// Mini Donut Chart using SVG
function DonutChart({ data, total, bgColor }: { data: any[]; total: number; bgColor: string }) {
    const size = width * 0.52;
    const cx = size / 2, cy = size / 2;
    const outerR = size * 0.42, innerR = size * 0.26;

    let startAngle = -Math.PI / 2;
    const slices = data
        .filter(d => d.bytes > 0)
        .map(d => {
            const angle = (d.bytes / total) * 2 * Math.PI;
            const x1 = cx + outerR * Math.cos(startAngle);
            const y1 = cy + outerR * Math.sin(startAngle);
            const x2 = cx + outerR * Math.cos(startAngle + angle);
            const y2 = cy + outerR * Math.sin(startAngle + angle);
            const ix1 = cx + innerR * Math.cos(startAngle + angle);
            const iy1 = cy + innerR * Math.sin(startAngle + angle);
            const ix2 = cx + innerR * Math.cos(startAngle);
            const iy2 = cy + innerR * Math.sin(startAngle);
            const large = angle > Math.PI ? 1 : 0;
            const path = `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2} Z`;
            startAngle += angle;
            return { path, color: d.color };
        });

    if (slices.length === 0) {
        return (
            <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
                <View style={{ width: outerR * 2, height: outerR * 2, borderRadius: outerR, borderWidth: (outerR - innerR), borderColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, color: '#94a3b8' }}>No files</Text>
                </View>
            </View>
        );
    }

    return (
        <Svg width={size} height={size}>
            <G>
                {slices.map((s, i) => <Path key={i} d={s.path} fill={s.color} />)}
                {/* Use dynamic bgColor so donut hole matches dark/light background */}
                <Circle cx={cx} cy={cy} r={innerR - 2} fill={bgColor} />
            </G>
        </Svg>
    );
}

export default function AnalyticsScreen({ navigation }: any) {
    const { theme } = useTheme();
    const C = theme.colors;
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>({});

    useEffect(() => {
        apiClient.get('/files/stats')
            .then(res => { if (res.data.success) setStats(res.data); })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const byType: Record<string, { count: number; bytes: number }> = {};
    (stats.storageByType || []).forEach((row: any) => {
        byType[row.category] = { count: row.count, bytes: parseInt(row.bytes) };
    });

    const totalBytes = stats.totalBytes || 0;
    const quotaBytes = 5 * 1024 ** 3; // 5 GB
    const usedPct = Math.min((totalBytes / quotaBytes) * 100, 100);

    const chartData = CATEGORIES.map(cat => ({
        ...cat,
        bytes: byType[cat.key]?.bytes || 0,
        count: byType[cat.key]?.count || 0,
    })).filter(d => d.bytes > 0);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: C.background }]}>
            <View style={[styles.header, { backgroundColor: C.background }]}>
                <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack()}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: C.textHeading }]}>Storage Analytics</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
                {loading ? (
                    <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 60 }} />
                ) : (
                    <>
                        {/* ── Storage Quota Card ── */}
                        <View style={[styles.quotaCard, { backgroundColor: C.card }]}>
                            <HardDrive color={C.primary} size={22} />
                            <View style={{ flex: 1, marginLeft: 14 }}>
                                <Text style={[styles.quotaTitle, { color: C.textBody }]}>Storage Used</Text>
                                <Text style={[styles.quotaValues, { color: C.textHeading }]}>
                                    {formatSize(totalBytes)}{' '}
                                    <Text style={{ color: C.textBody, fontWeight: '400' }}>/ 5 GB</Text>
                                </Text>
                                <View style={[styles.quotaBarTrack, { backgroundColor: C.border }]}>
                                    <View style={[styles.quotaBarFill, { width: `${usedPct.toFixed(0)}%` as any, backgroundColor: C.primary }]} />
                                </View>
                            </View>
                            <Text style={[styles.quotaPct, { color: usedPct > 80 ? '#EF4444' : C.primary }]}>
                                {usedPct.toFixed(0)}%
                            </Text>
                        </View>

                        {/* ── Quick Stats ── */}
                        <View style={styles.statsRow}>
                            {[
                                { label: 'Files', value: stats.totalFiles ?? 0, color: C.primary },
                                { label: 'Folders', value: stats.totalFolders ?? 0, color: '#F59E0B' },
                                { label: 'Starred', value: stats.starredCount ?? 0, color: '#1FD45A' },
                                { label: 'In Trash', value: stats.trashCount ?? 0, color: '#EF4444' },
                            ].map((s, i) => (
                                <View key={i} style={[styles.statCard, { backgroundColor: C.card }]}>
                                    <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
                                    <Text style={[styles.statLabel, { color: C.textBody }]}>{s.label}</Text>
                                </View>
                            ))}
                        </View>

                        {/* ── Donut Chart ── */}
                        <View style={[styles.chartSection, { backgroundColor: C.card }]}>
                            <Text style={[styles.sectionTitle, { color: C.textHeading }]}>Breakdown by Type</Text>
                            <View style={{ alignItems: 'center', marginVertical: 16 }}>
                                {/* Pass dynamic bgColor so donut hole works in dark mode */}
                                <DonutChart data={chartData} total={totalBytes || 1} bgColor={C.card} />
                                {totalBytes === 0 && (
                                    <Text style={{ position: 'absolute', color: C.textBody, fontSize: 14 }}>No files yet</Text>
                                )}
                            </View>

                            {/* ── Legend ── */}
                            {CATEGORIES.map(cat => {
                                const d = byType[cat.key];
                                if (!d || d.bytes === 0) return null;
                                // ✅ FIX: guard against totalBytes=0 to prevent NaN%
                                const pct = totalBytes > 0 ? formatPct(d.bytes, totalBytes) : '0';
                                const CatIcon = cat.icon;
                                return (
                                    <View key={cat.key} style={[styles.legendRow, { borderTopColor: C.border }]}>
                                        <View style={[styles.legendDot, { backgroundColor: cat.color }]} />
                                        <CatIcon color={cat.color} size={16} />
                                        <Text style={[styles.legendLabel, { color: C.textHeading }]}>{cat.label}</Text>
                                        <View style={{ flex: 1, marginHorizontal: 12 }}>
                                            <View style={[styles.legendBarTrack, { backgroundColor: C.border }]}>
                                                <View style={[styles.legendBarFill, { width: `${pct}%` as any, backgroundColor: cat.color }]} />
                                            </View>
                                        </View>
                                        <Text style={[styles.legendSize, { color: C.textBody }]}>{formatSize(d.bytes)}</Text>
                                        <Text style={[styles.legendPct, { color: C.textHeading }]}>{pct}%</Text>
                                    </View>
                                );
                            })}
                            {chartData.length === 0 && (
                                <Text style={{ textAlign: 'center', color: C.textBody, marginTop: 10 }}>Upload files to see breakdown</Text>
                            )}
                        </View>
                    </>
                )}
                <View style={{ height: 40 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 20, fontWeight: '700' },

    quotaCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, padding: 18, marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3 },
    quotaTitle: { fontSize: 13, marginBottom: 4 },
    quotaValues: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
    quotaBarTrack: { width: '100%', height: 8, borderRadius: 4 },
    quotaBarFill: { height: '100%', borderRadius: 4 },
    quotaPct: { fontSize: 18, fontWeight: '800', marginLeft: 10 },

    statsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
    statCard: { flex: 1, borderRadius: 16, padding: 14, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
    statVal: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
    statLabel: { fontSize: 11, fontWeight: '600' },

    chartSection: { borderRadius: 24, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
    sectionTitle: { fontSize: 16, fontWeight: '700' },

    legendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8, borderTopWidth: 1 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendLabel: { fontSize: 13, fontWeight: '600', width: 80 },
    legendBarTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
    legendBarFill: { height: '100%', borderRadius: 3 },
    legendSize: { fontSize: 12, width: 58, textAlign: 'right' },
    legendPct: { fontSize: 12, fontWeight: '700', width: 38, textAlign: 'right' },
});
