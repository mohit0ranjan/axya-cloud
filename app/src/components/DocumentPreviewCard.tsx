import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { FileText, LockKeyhole } from "lucide-react-native";
import { useTheme } from "../context/ThemeContext";
export default function DocumentPreviewCard({
  name,
  mimeType,
}: {
  name: string;
  mimeType: string;
}) {
  const { theme } = useTheme();
  const C = theme.colors;
  const ext = name.includes(".")
    ? name.split(".").pop()?.toUpperCase()
    : "FILE";
  return (
    <View style={s.wrap}>
      <View
        style={[s.document, { backgroundColor: C.card, borderColor: C.border }]}
      >
        <View style={[s.fileBadge, { backgroundColor: C.primaryLight }]}>
          <FileText color={C.primary} size={40} strokeWidth={1.5} />
        </View>
        <Text style={[s.extension, { color: C.primary }]}>{ext}</Text>
        <View style={[s.line, { backgroundColor: C.border }]} />
        <View style={[s.line, { backgroundColor: C.border, width: "70%" }]} />
        <View style={[s.line, { backgroundColor: C.border, width: "85%" }]} />
      </View>
      <Text style={[s.name, { color: C.textHeading }]} numberOfLines={2}>
        {name}
      </Text>
      <Text style={[s.help, { color: C.textBody }]}>
        {mimeType === "application/pdf"
          ? "Download to read this PDF in your favourite viewer."
          : "Download the original file to open it in a compatible app."}
      </Text>
      <View style={s.private}>
        <LockKeyhole size={12} color={C.textBody} />
        <Text style={[s.privateText, { color: C.textBody }]}>
          Stored in your Telegram
        </Text>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  document: {
    width: 156,
    height: 194,
    borderRadius: 18,
    borderWidth: 1,
    padding: 22,
    marginBottom: 26,
  },
  fileBadge: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  extension: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 16,
  },
  line: { height: 4, borderRadius: 2, width: "100%", marginBottom: 9 },
  name: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    lineHeight: 26,
    textAlign: "center",
    maxWidth: 300,
  },
  help: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 280,
    marginTop: 10,
  },
  private: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    marginTop: 20,
  },
  privateText: { fontFamily: "Inter_400Regular", fontSize: 11 },
});
