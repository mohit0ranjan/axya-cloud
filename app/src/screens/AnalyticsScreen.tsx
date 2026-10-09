import { LibraryHeader } from "../components/LibraryUI";
import { ErrorState } from "../ui/ErrorState";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  MoreHorizontal,
  HardDrive,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Archive,
  Folder,
  Star,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react-native";
import apiClient from "../services/apiClient";
import { useTheme } from "../context/ThemeContext";
import { formatSize, formatPct } from "../utils/format";
import { SkeletonBlock } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import Svg, {
  Circle,
  G,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
} from "react-native-svg";

const { width } = Dimensions.get("window");

const CATEGORIES = [
  { key: "image", label: "Images", color: "#FF5A1F", icon: ImageIcon },
  { key: "video", label: "Videos", color: "#3B82F6", icon: Film },
  { key: "pdf", label: "Documents", color: "#10B981", icon: FileText },
  { key: "audio", label: "Audio", color: "#F59E0B", icon: Music },
  { key: "archive", label: "Archives", color: "#EC4899", icon: Archive },
  { key: "other", label: "Others", color: "#8B5CF6", icon: HardDrive },
];

function LibraryCount({ count, colours }: any) {
  return (
    <View
      style={{
        width: 108,
        height: 108,
        borderRadius: 32,
        backgroundColor: colours.primaryLight,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <HardDrive color={colours.primary} size={25} strokeWidth={1.7} />
      <Text
        style={{
          color: colours.textHeading,
          fontFamily: "Inter_700Bold",
          fontSize: 25,
        }}
      >
        {count}
      </Text>
      <Text style={{ color: colours.primary, fontSize: 11 }}>Files stored</Text>
    </View>
  );
}
export default function AnalyticsScreen({ navigation }: any) {
  const { theme, isDark } = useTheme();
  const C = theme.colors;
  const insets = useSafeAreaInsets();

  // Tokens matching the requested minimal premium palette
  const BG_COLOR = C.background;
  const CARD_BG = C.card;
  const BORDER = isDark ? "#262626" : "#E2E8F0";
  const TEXT_MAIN = isDark ? "#F8FAFC" : "#0F172A";
  const TEXT_SUB = isDark ? "#94A3B8" : "#64748B";
  const PRIMARY_ACCENT = C.primary;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [stats, setStats] = useState<any>({});

  const loadData = useCallback(async () => {
    setLoadError("");
    try {
      const res = await apiClient.get("/files/stats");
      if (!res.data?.success) throw Error("Storage unavailable");
      setStats(res.data);
    } catch (error) {
      setLoadError("Storage information could not be refreshed.");
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
  const usedGB = totalBytes / 1024 ** 3;

  const chartData = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      ...cat,
      bytes: byType[cat.key]?.bytes || 0,
      count: byType[cat.key]?.count || 0,
    }))
      .filter((d) => d.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes); // Sort by highest usage
  }, [stats]);

  const health = {
    msg: "Original files are stored in your Telegram account.",
    color: C.primary,
    icon: Info,
  };
  const HealthIcon = health.icon;

  return (
    <View
      style={[st.root, { backgroundColor: BG_COLOR, paddingTop: insets.top }]}
    >
      <LibraryHeader
        title="Storage"
        subtitle="A clear view of your library"
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={st.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadData();
            }}
            tintColor={PRIMARY_ACCENT}
          />
        }
      >
        {!!loadError && (
          <ErrorState
            title="Storage unavailable"
            message={loadError}
            onRetry={() => {
              setLoading(true);
              void loadData();
            }}
          />
        )}
        {loading ? (
          <View style={{ gap: 20 }}>
            <SkeletonBlock width="100%" height={240} borderRadius={24} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <SkeletonBlock width="48%" height={100} borderRadius={24} />
              <SkeletonBlock width="48%" height={100} borderRadius={24} />
            </View>
            <SkeletonBlock width="100%" height={300} borderRadius={24} />
          </View>
        ) : loadError && !stats.success ? null : (
          <>
            {/* 2. STORAGE OVERVIEW CARD */}
            <View
              style={[
                st.card,
                { backgroundColor: CARD_BG, borderColor: BORDER },
              ]}
            >
              <Text style={[st.cardTitle, { color: TEXT_MAIN }]}>Overview</Text>

              <View style={st.overviewRow}>
                <View style={st.overviewTextWrap}>
                  <Text style={[st.overviewLabel, { color: TEXT_SUB }]}>
                    Total Used
                  </Text>
                  <Text style={[st.overviewValue, { color: TEXT_MAIN }]}>
                    {formatSize(totalBytes)}
                  </Text>
                  <View
                    style={[
                      st.unlimitedBadge,
                      { backgroundColor: C.primaryLight },
                    ]}
                  >
                    <Text style={[st.unlimitedText, { color: C.primary }]}>
                      Telegram storage
                    </Text>
                  </View>
                </View>
                <LibraryCount count={stats.totalFiles || 0} colours={C} />
              </View>

              {/* 4. HEALTH MESSAGE */}
              <View
                style={[
                  st.healthBox,
                  { backgroundColor: isDark ? "#1E293B" : "#EFF6FF" },
                ]}
              >
                <HealthIcon color={health.color} size={18} />
                <Text style={[st.healthText, { color: TEXT_MAIN }]}>
                  {health.msg}
                </Text>
              </View>

              {/* 3. STORAGE BAR (COMPOSITION) */}
              <Text
                style={[
                  st.cardTitle,
                  {
                    color: TEXT_MAIN,
                    marginTop: 24,
                    marginBottom: 12,
                    fontSize: 14,
                  },
                ]}
              >
                Composition
              </Text>
              <View
                style={[
                  st.stackedBarTrack,
                  { backgroundColor: isDark ? "#262626" : "#E2E8F0" },
                ]}
              >
                {totalBytes === 0 ? (
                  <View
                    style={[
                      st.stackedBarSegment,
                      { backgroundColor: BORDER, width: "100%" },
                    ]}
                  />
                ) : (
                  chartData.map((d, idx) => (
                    <View
                      key={idx}
                      style={[
                        st.stackedBarSegment,
                        {
                          backgroundColor: d.color,
                          width: `${(d.bytes / totalBytes) * 100}%`,
                          borderTopLeftRadius: idx === 0 ? 8 : 0,
                          borderBottomLeftRadius: idx === 0 ? 8 : 0,
                          borderTopRightRadius:
                            idx === chartData.length - 1 ? 8 : 0,
                          borderBottomRightRadius:
                            idx === chartData.length - 1 ? 8 : 0,
                        },
                      ]}
                    />
                  ))
                )}
              </View>
            </View>

            {/* 5. STATS GRID */}
            <View style={st.statsGrid}>
              {[
                {
                  label: "Files",
                  value: stats.totalFiles ?? 0,
                  icon: FileText,
                  color: "#3B82F6",
                  nav: "AllFiles",
                },
                {
                  label: "Folders",
                  value: stats.totalFolders ?? 0,
                  icon: Folder,
                  color: "#10B981",
                  nav: "Folders",
                },
                {
                  label: "Starred",
                  value: stats.starredCount ?? 0,
                  icon: Star,
                  color: "#F59E0B",
                  nav: "Starred",
                },
                {
                  label: "Trash",
                  value: stats.trashCount ?? 0,
                  icon: Trash2,
                  color: "#EF4444",
                  nav: "Trash",
                },
              ].map((s, i) => {
                const IconNode = s.icon;
                return (
                  <TouchableOpacity
                    key={i}
                    accessibilityRole="button"
                    accessibilityLabel={`Browse ${s.label.toLowerCase()}`}
                    style={[
                      st.statCard,
                      { backgroundColor: CARD_BG, borderColor: BORDER },
                    ]}
                    activeOpacity={0.7}
                    onPress={() => navigation?.navigate(s.nav)}
                  >
                    <View
                      style={[
                        st.statIconBox,
                        { backgroundColor: `${s.color}15` },
                      ]}
                    >
                      <IconNode color={s.color} size={20} />
                    </View>
                    <Text style={[st.statVal, { color: TEXT_MAIN }]}>
                      {s.value}
                    </Text>
                    <Text style={[st.statLabel, { color: TEXT_SUB }]}>
                      {s.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 6. COMPOSITION BREAKDOWN LIST */}
            <View
              style={[
                st.card,
                {
                  backgroundColor: CARD_BG,
                  borderColor: BORDER,
                  marginBottom: 120,
                },
              ]}
            >
              <Text
                style={[st.cardTitle, { color: TEXT_MAIN, marginBottom: 16 }]}
              >
                Detailed Breakdown
              </Text>

              {chartData.map((d, index) => {
                const pct =
                  totalBytes > 0
                    ? ((d.bytes / totalBytes) * 100).toFixed(1)
                    : "0";
                const CatIcon = d.icon;
                return (
                  <View key={d.key}>
                    <View style={st.breakdownRow}>
                      <View style={st.breakdownRowLeft}>
                        <View
                          style={[
                            st.catIconBox,
                            { backgroundColor: `${d.color}15` },
                          ]}
                        >
                          <CatIcon color={d.color} size={18} />
                        </View>
                        <View>
                          <Text
                            style={[st.breakdownText, { color: TEXT_MAIN }]}
                          >
                            {d.label}
                          </Text>
                          <Text
                            style={[st.breakdownCount, { color: TEXT_SUB }]}
                          >
                            {d.count} files
                          </Text>
                        </View>
                      </View>
                      <View style={st.breakdownRowRight}>
                        <Text style={[st.breakdownSize, { color: TEXT_MAIN }]}>
                          {formatSize(d.bytes)}
                        </Text>
                        <Text
                          style={[
                            st.breakdownPct,
                            {
                              backgroundColor: isDark ? "#262626" : "#E2E8F0",
                              color: TEXT_SUB,
                            },
                          ]}
                        >
                          {pct}%
                        </Text>
                      </View>
                    </View>
                    {index < chartData.length - 1 && (
                      <View
                        style={[
                          st.breakdownDivider,
                          { backgroundColor: BORDER },
                        ]}
                      />
                    )}
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
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 10,
    paddingHorizontal: 20,
    paddingVertical: 18,
    minHeight: 72,
  },
  iconBtn: { padding: 8 },
  headerTitle: {
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.6,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36 },

  card: {
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    borderRadius: 28,
    shadowOpacity: 0,
    elevation: 0,
  },
  cardTitle: {
    fontWeight: "700",
    marginBottom: 20,
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },

  overviewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  overviewTextWrap: { flex: 1 },
  overviewLabel: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
    fontFamily: "Inter_500Medium",
  },
  overviewValue: {
    fontSize: 34,
    fontWeight: "800",
    marginBottom: 8,
    letterSpacing: 0.1,
    fontFamily: "Inter_700Bold",
  },
  unlimitedBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FF5A1F15",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  unlimitedText: {
    color: "#FF5A1F",
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  circularContainer: {
    width: 120,
    height: 120,
    justifyContent: "center",
    alignItems: "center",
  },
  circularLabelWrap: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  circularLabelValue: {
    fontSize: 24,
    fontWeight: "800",
    marginBottom: -2,
    fontFamily: "Inter_700Bold",
  },
  circularLabelSub: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  healthBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    gap: 10,
  },
  healthText: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
    lineHeight: 20,
    fontFamily: "Inter_500Medium",
  },

  stackedBarTrack: {
    height: 16,
    borderRadius: 8,
    flexDirection: "row",
    width: "100%",
    overflow: "hidden",
  },
  stackedBarSegment: { height: "100%" },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 20,
  },
  statCard: { width: "48%", padding: 16, borderWidth: 1, borderRadius: 16 },
  statIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  statVal: {
    fontSize: 34,
    fontWeight: "700",
    marginBottom: 2,
    letterSpacing: 0.1,
    fontFamily: "Inter_700Bold",
  },
  statLabel: { fontSize: 14, fontWeight: "500", fontFamily: "Inter_500Medium" },

  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
  },
  breakdownRowLeft: { flexDirection: "row", alignItems: "center", gap: 14 },
  catIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  breakdownText: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
    fontFamily: "Inter_600SemiBold",
  },
  breakdownCount: {
    fontSize: 12,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  breakdownRowRight: { alignItems: "flex-end", gap: 6 },
  breakdownSize: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  breakdownPct: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
    fontFamily: "Inter_600SemiBold",
  },
  breakdownDivider: { height: StyleSheet.hairlineWidth, marginLeft: 54 },
});
