import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import {
  Image,
  FileText,
  Film,
  Music,
  ArrowRight,
  Upload,
  Mic,
  Link2,
  FolderPlus,
  ArrowUpDown,
  ChevronRight,
} from "lucide-react-native";
import { useTheme } from "../context/ThemeContext";
import { useUpload } from "../context/UploadContext";
import { libraryTone } from "./LibraryUI";
import { LinearGradient } from "expo-linear-gradient";
import { HardDrive } from "lucide-react-native";
import { formatSize } from "../utils/format";
import { SkeletonBlock } from "../ui/Skeleton";

export function HomeStorage({ stats, loading, navigation }: any) {
  const { theme } = useTheme();
  const C = theme.colors;
  if (loading && !stats.success)
    return (
      <View style={{ marginHorizontal: 24, marginBottom: 22 }}>
        <SkeletonBlock width="100%" height={204} borderRadius={28} />
      </View>
    );
  const hasStats = stats.success === true;
  const count = Number(stats.totalFiles || 0);
  const byType = Array.isArray(stats.storageByType) ? stats.storageByType : [];
  const photos = Number(
    stats.image_count ??
      byType.find((row: any) => row.category === "image")?.count ??
      0,
  );
  const videos = Number(
    stats.video_count ??
      byType.find((row: any) => row.category === "video")?.count ??
      0,
  );
  const metrics = [
    { title: "Photos", count: photos, Icon: Image, colour: "#FDD776" },
    { title: "Videos", count: videos, Icon: Film, colour: "#DCD0FF" },
    {
      title: "Files",
      count: Math.max(0, count - photos - videos),
      Icon: FileText,
      colour: "#B5E8DB",
    },
  ];
  return (
    <View style={{ marginHorizontal: 24, marginBottom: 22, paddingBottom: 8 }}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          bottom: 0,
          height: 70,
          backgroundColor: C.primaryLight,
          borderRadius: 24,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View storage details"
        onPress={() => navigation.navigate("Analytics")}
        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
      >
        <LinearGradient
          colors={[C.gradientStart, C.gradientMid]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.85 }}
          style={{ borderRadius: 28, overflow: "hidden", padding: 20 }}
        >
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              right: -52,
              top: -62,
              width: 230,
              height: 230,
              borderRadius: 115,
              borderWidth: 1,
              borderColor: "#FFFFFF18",
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              right: -24,
              top: -34,
              width: 174,
              height: 174,
              borderRadius: 87,
              backgroundColor: "#FFFFFF08",
              borderWidth: 1,
              borderColor: "#FFFFFF10",
            }}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: "#EEF3FF",
                fontFamily: "Inter_500Medium",
                fontSize: 13,
              }}
            >
              Your storage
            </Text>
            <View
              style={{
                width: 25,
                height: 25,
                borderRadius: 13,
                backgroundColor: "#FFFFFF16",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ArrowRight size={15} color="#FFFFFF" />
            </View>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              marginTop: 8,
              marginBottom: 19,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  color: "#FFF",
                  fontFamily: "Inter_700Bold",
                  fontSize: hasStats ? 33 : 25,
                  lineHeight: 43,
                  letterSpacing: -1,
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {hasStats
                  ? formatSize(
                      Number(stats.total_size || stats.totalBytes || 0),
                    )
                  : "Unavailable"}
              </Text>
              <Text
                style={{
                  color: "#EEF3FF",
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  lineHeight: 18,
                  marginTop: 2,
                }}
              >
                {hasStats
                  ? count + (count === 1 ? " file" : " files") + " in Telegram"
                  : "Tap to check storage"}
              </Text>
            </View>
            <View
              style={{
                width: 60,
                height: 60,
                padding: 6,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: "#FFFFFF28",
                backgroundColor: "#FFFFFF10",
                transform: [{ rotate: "-6deg" }],
              }}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: 16,
                  backgroundColor: "#FFFFFF18",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <HardDrive size={27} color="#FFFFFF" strokeWidth={1.5} />
              </View>
            </View>
          </View>
          {hasStats && (
            <View
              style={{
                flexDirection: "row",
                gap: 6,
                borderTopWidth: 1,
                borderTopColor: "#FFFFFF24",
                paddingTop: 13,
              }}
            >
              {metrics.map(({ title, count: total, Icon, colour }) => (
                <View
                  key={title}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Icon size={13} color={colour} strokeWidth={1.8} />
                  <Text
                    style={{
                      flex: 1,
                      color: "#FFFFFF",
                      fontFamily: "Inter_500Medium",
                      fontSize: 10,
                      lineHeight: 16,
                    }}
                    numberOfLines={1}
                  >
                    {total + " " + (total === 1 ? title.slice(0, -1) : title)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const categories = [
  { type: "image", title: "Photos", Icon: Image, tone: "rose" },
  { type: "document", title: "Documents", Icon: FileText, tone: "amber" },
  { type: "video", title: "Videos", Icon: Film, tone: "violet" },
  { type: "audio", title: "Audio", Icon: Music, tone: "mint" },
];

export function HomeCategories({ navigation }: any) {
  const { theme, isDark } = useTheme();
  return (
    <View style={s.categories}>
      <View style={s.heading}>
        <Text style={[s.title, { color: theme.colors.textHeading }]}>
          Browse by type
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discover all files"
          onPress={() => navigation.navigate("Discover")}
          style={s.more}
        >
          <ArrowRight size={18} color={theme.colors.primary} />
        </Pressable>
      </View>
      <View style={s.grid}>
        {categories.map(({ type, title, Icon, tone }) => {
          const colours = libraryTone(isDark, tone);
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityLabel={`Browse ${title.toLowerCase()}`}
              onPress={() => navigation.navigate("Discover", { type })}
              style={({ pressed }) => [
                s.category,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <View style={[s.icon, { backgroundColor: colours.background }]}>
                <Icon size={24} color={colours.ink} strokeWidth={1.7} />
              </View>
              <Text
                style={[s.categoryLabel, { color: theme.colors.textHeading }]}
                numberOfLines={1}
              >
                {title}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function HomeActions({
  navigation,
  onUpload,
  onRecord,
  onNewFolder,
}: any) {
  const { theme, isDark } = useTheme();
  const C = theme.colors;
  const queue = useUpload();
  const mint = libraryTone(isDark, "mint");
  return (
    <View style={s.root}>
      <View style={s.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Upload files"
          onPress={onUpload}
          style={({ pressed }) => [
            s.tile,
            { backgroundColor: C.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Upload size={23} color="#FFF" strokeWidth={1.8} />
          <Text style={[s.tileLabel, { color: "#FFF" }]}>Upload files</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create new folder"
          onPress={onNewFolder}
          style={({ pressed }) => [
            s.tile,
            { backgroundColor: mint.background, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <FolderPlus size={23} color={mint.ink} strokeWidth={1.8} />
          <Text style={[s.tileLabel, { color: mint.ink }]}>New folder</Text>
        </Pressable>
      </View>
      <View style={s.secondary}>
        {[
          { text: "Voice note", Icon: Mic, action: onRecord },
          {
            text: "Shared links",
            Icon: Link2,
            action: () => navigation.navigate("SharedLinks"),
          },
        ].map(({ text, Icon, action }) => (
          <Pressable
            key={text}
            accessibilityRole="button"
            onPress={action}
            style={({ pressed }) => [
              s.pill,
              { backgroundColor: C.card, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Icon size={16} color={C.primary} />
            <Text style={[s.label, { color: C.textHeading }]}>{text}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open transfers"
        onPress={() => navigation.navigate("UploadManager")}
        style={s.transfers}
      >
        <ArrowUpDown size={16} color={C.primary} />
        <Text
          style={[
            s.transferText,
            { color: queue.failedCount ? C.danger : C.textBody },
          ]}
        >
          {queue.failedCount
            ? `${queue.failedCount} uploads need attention`
            : queue.pausedCount && queue.pausedCount === queue.activeCount
              ? `${queue.pausedCount} uploads paused`
              : queue.activeCount
                ? `${queue.activeCount} uploads in progress or queued`
                : "Transfers · All caught up"}
        </Text>
        <ChevronRight size={16} color={C.textBody} />
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  categories: { paddingHorizontal: 24, marginBottom: 24 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 17, letterSpacing: -0.3 },
  more: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: { flexDirection: "row", gap: 8 },
  category: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 9,
    paddingVertical: 4,
  },
  icon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    lineHeight: 16,
  },
  root: { paddingHorizontal: 24, marginBottom: 14 },
  actions: { flexDirection: "row", gap: 12 },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 23,
    minHeight: 92,
    padding: 18,
    gap: 13,
  },
  tileLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20 },
  secondary: { flexDirection: "row", gap: 12, marginTop: 12 },
  pill: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 18,
    minHeight: 46,
  },
  label: { fontFamily: "Inter_500Medium", fontSize: 12 },
  transfers: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  transferText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 18,
  },
});
