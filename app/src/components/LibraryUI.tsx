import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import {
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  CloudDownload,
  Camera,
  Search,
  Link2,
  ScanLine,
  ShieldCheck,
  ArrowUpDown,
  Tags,
  Files,
  PencilLine,
  BatteryCharging,
  Wifi,
  FileDown,
  Settings2,
} from "lucide-react-native";
import { useTheme } from "../context/ThemeContext";

export const libraryTone = (dark: boolean, tone = "blue") => {
  const tones: Record<string, [string, string]> = {
    blue: ["#EAF2FF", "#2563EB"],
    mint: ["#EAF6EE", "#287850"],
    violet: ["#F0EBFC", "#7950C5"],
    amber: ["#FFF5DA", "#9A6C10"],
    rose: ["#FDEDF1", "#B83E68"],
  };
  const [background, ink] = tones[tone] || tones.blue;
  return {
    background: dark ? `${ink}26` : background,
    ink: dark
      ? (
          {
            blue: "#93BFFF",
            mint: "#86D8AC",
            violet: "#C5AAFF",
            amber: "#F4CE75",
            rose: "#F7A8C1",
          } as any
        )[tone] || "#93BFFF"
      : ink,
  };
};
const destinations: Record<string, [any, string]> = {
  "Drive tools": [Settings2, "blue"],
  "Offline files": [CloudDownload, "mint"],
  "Photo backup": [Camera, "rose"],
  "Scan a document": [ScanLine, "amber"],
  "Upload files": [ArrowUpDown, "blue"],
  "Collections & advanced search": [Search, "violet"],
  "Bulk rename": [PencilLine, "amber"],
  "File requests": [Link2, "mint"],
  "Recovery centre": [ShieldCheck, "mint"],
  "Export file manifest": [FileDown, "violet"],
  "Unmetered networks only": [Wifi, "blue"],
  "Upload while charging": [BatteryCharging, "amber"],
  "File tools": [Tags, "violet"],
  "Organise files": [Files, "amber"],
  Discover: [Search, "violet"],
  "Collections & search": [Search, "violet"],
  "Make available offline": [CloudDownload, "mint"],
  "Remove offline copy": [CloudDownload, "mint"],
  "Add tag": [Tags, "violet"],
  "Use an uploaded file as a new version": [Files, "blue"],
  "Find files of the same type": [Search, "blue"],
  "Find files": [Search, "blue"],
  "Choose an album": [Camera, "rose"],
  "Enable photo backup": [Camera, "mint"],
  "Update backup settings": [Settings2, "blue"],
  "Wi-Fi & charging preferences": [Wifi, "blue"],
  "Create request link": [Link2, "mint"],
  "Share this link": [Link2, "blue"],
  "Undo last rename": [PencilLine, "amber"],
};
export function LibraryGlyph({
  title,
  size = 48,
}: {
  title: string;
  size?: number;
}) {
  const { isDark } = useTheme();
  const [Icon, tone] = destinations[title] || [Files, "blue"];
  const colours = libraryTone(isDark, tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: colours.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon color={colours.ink} size={size * 0.46} strokeWidth={1.8} />
    </View>
  );
}
export function LibraryHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={s.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => [
          s.back,
          { backgroundColor: pressed ? c.primaryLight : c.card },
        ]}
      >
        <ArrowLeft color={c.textHeading} size={22} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[s.title, { color: c.textHeading }]}>
          {title}
        </Text>
        {subtitle && (
          <Text
            style={[
              s.subtitle,
              { color: theme.mode === "dark" ? "#A5B0C5" : "#65748B" },
            ]}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {right}
    </View>
  );
}
export function LibraryShortcut({
  title,
  detail,
  icon: Icon,
  tone = "blue",
  onPress,
}: any) {
  const { theme, isDark } = useTheme();
  const colours = libraryTone(isDark, tone);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.shortcut,
        { backgroundColor: colours.background, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Icon color={colours.ink} size={23} strokeWidth={1.8} />
      <Text style={[s.shortcutTitle, { color: theme.colors.textHeading }]}>
        {title}
      </Text>
      {detail && (
        <Text
          style={[s.shortcutDetail, { color: isDark ? "#A5B0C5" : "#65748B" }]}
        >
          {detail}
        </Text>
      )}
      <ChevronRight
        color={colours.ink}
        size={16}
        style={{ position: "absolute", right: 14, top: 18 }}
      />
    </Pressable>
  );
}
const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 24, letterSpacing: -0.7 },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  shortcut: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: 118,
    padding: 18,
    borderRadius: 24,
    gap: 8,
  },
  shortcutTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  shortcutDetail: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
  },
});
