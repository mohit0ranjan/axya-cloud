import { LibraryHeader } from "../components/LibraryUI";
import { EmptyState } from "../ui/EmptyState";
import { ToolInput } from "../components/DriveToolLayout";
import React, { useContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { ArrowLeft, FileCheck2, Trash2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import {
  listOfflineFiles,
  OfflineFile,
  openOfflineFile,
  removeOfflineFile,
  subscribeOffline,
} from "../services/offlineFiles";
export default function OfflineFilesScreen({ navigation }: any) {
  const { user } = useContext(AuthContext)!;
  const { theme } = useTheme();
  const c = theme.colors;
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<OfflineFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void listOfflineFiles(user.id)
        .then((files) => {
          if (alive) setRows(files);
        })
        .catch(() => showToast("Offline files could not be read.", "error"))
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    refresh();
    const stop = subscribeOffline(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [user.id]);
  const open = async (file: OfflineFile) => {
    try {
      const asset = await openOfflineFile(user.id, file.id);
      if (!asset)
        throw new Error(
          "Offline copy is missing. Save this file again when online.",
        );
      navigation.navigate("FilePreview", {
        files: [{ ...file, offline_uri: asset.uri }],
        initialIndex: 0,
        offlineSession: true,
      });
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };
  return (
    <View
      style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}
    >
      <LibraryHeader
        title="Offline files"
        subtitle={rows.length + " saved on this device"}
        onBack={() => navigation.goBack()}
      />
      <View
        style={{
          marginHorizontal: 20,
          backgroundColor: c.primaryLight,
          padding: 22,
          borderRadius: 28,
          marginBottom: 16,
        }}
      >
        <FileCheck2 color={c.primary} size={26} />
        <Text
          style={{
            color: c.textHeading,
            fontFamily: "Inter_700Bold",
            fontSize: 23,
            marginTop: 12,
          }}
        >
          {(rows.reduce((sum, f) => sum + f.size, 0) / 1024 ** 2).toFixed(1)} MB
          available offline
        </Text>
        <Text
          style={{
            color: theme.mode === "dark" ? "#A5B0C5" : "#65748B",
            fontSize: 12,
            lineHeight: 19,
            marginTop: 8,
          }}
        >
          Your saved copies stay on this device. Removing a copy keeps your
          Telegram original.
        </Text>
      </View>
      <View style={{ marginHorizontal: 20 }}>
        <ToolInput
          accessibilityLabel="Search offline files"
          placeholder="Search saved files"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      {loading ? (
        <ActivityIndicator color={c.primary} />
      ) : (
        <FlatList
          data={rows.filter((f) =>
            f.name.toLowerCase().includes(query.trim().toLowerCase()),
          )}
          keyExtractor={(f) => f.id}
          contentContainerStyle={{
            padding: 20,
            paddingBottom: insets.bottom + 24,
            gap: 12,
          }}
          ListEmptyComponent={
            <EmptyState
              title={query ? "No matching copies" : "Take your files with you"}
              description={
                query
                  ? "Try another file name."
                  : "Open a file’s tools and choose Save offline."
              }
              iconType="file"
            />
          }
          renderItem={({ item }) => (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 0,
                borderColor: c.border,
                backgroundColor: c.card,
                borderRadius: 24,
                padding: 16,
                gap: 14,
              }}
            >
              <FileCheck2 color={c.primary} size={24} />
              <Pressable
                style={{ flex: 1 }}
                accessibilityRole="button"
                onPress={() => open(item)}
              >
                <Text
                  style={{
                    color: c.textHeading,
                    fontFamily: "Inter_600SemiBold",
                  }}
                  numberOfLines={2}
                >
                  {item.name}
                </Text>
                <Text style={{ color: c.textBody, marginTop: 6 }}>
                  {(item.size / 1024 ** 2).toFixed(1)} MB · Saved{" "}
                  {new Date(item.savedAt).toLocaleDateString()}
                </Text>
              </Pressable>
              <Pressable
                style={{ padding: 12 }}
                accessibilityLabel={`Remove offline copy of ${item.name}`}
                onPress={() => {
                  void removeOfflineFile(user.id, item.id).catch(() =>
                    showToast("Could not remove offline copy.", "error"),
                  );
                }}
              >
                <Trash2 color={c.muted} size={20} />
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}
