import React, { useEffect, useState } from "react";
import { Text, View, Pressable } from "react-native";
import apiClient from "../services/apiClient";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";
import { ToolPage, ToolRow, ToolInput } from "../components/DriveToolLayout";
import { syncAfterFileMutation } from "../services/fileStateSync";
export default function BulkOrganiseScreen({ navigation }: any) {
  const { showToast } = useToast();
  const { theme } = useTheme();
  const [files, setFiles] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [prefix, setPrefix] = useState(""),
    [undo, setUndo] = useState<any[] | null>(null),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState("");
  const load = async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.get("/files/discover", {
        params: { q: query },
      });
      setFiles(data.files);
      setSelected([]);
    } catch {
      showToast("Files could not load.", "error");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const changes = files
    .filter((f) => selected.includes(f.id))
    .map((f, i) => ({
      id: f.id,
      expectedName: f.name,
      name: `${prefix.trim()} ${String(i + 1).padStart(3, "0")}${/\.[^.]+$/.exec(f.name)?.[0] || ""}`,
    }));
  const apply = async (isUndo = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await apiClient.post("/files/bulk-rename", {
        changes: isUndo ? undo : changes,
      });
      setUndo(isUndo ? null : data.undo);
      syncAfterFileMutation();
      showToast(isUndo ? "Names restored" : "Files renamed");
      await load();
    } catch (e: any) {
      showToast(e.response?.data?.message || "Rename failed.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ToolPage
      title="Bulk rename"
      subtitle="Select files and preview the resulting names before applying. Extensions are preserved."
      navigation={navigation}
    >
      <ToolInput
        placeholder="Find files to rename"
        value={query}
        onChangeText={setQuery}
      />
      <ToolRow title="Find files" disabled={busy} onPress={() => void load()} />
      <ToolInput
        placeholder="New name prefix"
        value={prefix}
        onChangeText={setPrefix}
        maxLength={180}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text
          style={{
            color: theme.colors.textHeading,
            fontFamily: "Inter_600SemiBold",
          }}
        >
          {selected.length} selected
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy || !files.length}
          onPress={() =>
            setSelected(
              selected.length === files.length ? [] : files.map((f) => f.id),
            )
          }
          style={{
            minHeight: 44,
            justifyContent: "center",
            paddingHorizontal: 12,
          }}
        >
          <Text style={{ color: theme.colors.primary }}>
            {selected.length === files.length && files.length
              ? "Clear selection"
              : "Select all results"}
          </Text>
        </Pressable>
      </View>
      {files.map((f) => (
        <ToolRow
          key={f.id}
          title={f.name}
          selected={selected.includes(f.id)}
          detail={
            selected.includes(f.id) && prefix.trim()
              ? `→ ${changes.find((c) => c.id === f.id)?.name}`
              : "Tap to select"
          }
          disabled={busy}
          onPress={() =>
            setSelected((old) =>
              old.includes(f.id)
                ? old.filter((id) => id !== f.id)
                : [...old, f.id],
            )
          }
        />
      ))}
      <ToolRow
        title={`Rename ${selected.length} files`}
        disabled={busy || !selected.length || !prefix.trim()}
        onPress={() => void apply()}
      />
      {undo && (
        <ToolRow
          title="Undo last rename"
          detail="Available until you leave this screen"
          disabled={busy}
          onPress={() => void apply(true)}
        />
      )}
      <Text style={{ color: theme.colors.textBody }}>
        Search results show up to 50 files at a time. Move, star and trash are
        available in the existing file selection tools.
      </Text>
    </ToolPage>
  );
}
