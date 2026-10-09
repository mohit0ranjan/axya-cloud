import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import {
  Upload,
  Mic,
  Link,
  ArrowUpDown,
  ChevronRight,
} from "lucide-react-native";
import { useTheme } from "../context/ThemeContext";
import { useUpload } from "../context/UploadContext";

export default function HomeQuickActions({
  navigation,
  onUpload,
  onRecord,
}: any) {
  const { theme } = useTheme();
  const C = theme.colors;
  const queue = useUpload();
  const pending = queue.activeCount;
  return (
    <View style={s.root}>
      <View style={s.actions}>
        {[
          { text: "Upload", Icon: Upload, action: onUpload },
          { text: "Record", Icon: Mic, action: onRecord },
          {
            text: "Shared links",
            Icon: Link,
            action: () => navigation.navigate("SharedLinks"),
          },
        ].map(({ text, Icon, action }) => (
          <Pressable
            key={text}
            accessibilityRole="button"
            onPress={action}
            style={({ pressed }) => [
              s.button,
              {
                borderColor: C.border,
                backgroundColor: C.card,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Icon size={17} color={C.primary} />
            <Text style={[s.label, { color: C.textHeading }]} numberOfLines={1}>
              {text}
            </Text>
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
            : pending
              ? `${pending} uploads in progress or queued`
              : "Transfers · No pending uploads"}
        </Text>
        <ChevronRight size={16} color={C.textBody} />
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  root: { paddingHorizontal: 24, marginTop: -8, marginBottom: 8 },
  actions: { flexDirection: "row", gap: 8 },
  button: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 6,
  },
  label: { fontFamily: "Inter_500Medium", fontSize: 11 },
  transfers: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 2,
  },
  transferText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 18,
  },
});
