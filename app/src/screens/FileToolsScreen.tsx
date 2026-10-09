import React, { useContext, useEffect, useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { AuthContext } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";
import { ToolPage, ToolRow, ToolInput } from "../components/DriveToolLayout";
import {
  listOfflineFiles,
  saveOfflineFile,
  removeOfflineFile,
} from "../services/offlineFiles";
import apiClient, { API_BASE } from "../services/apiClient";
import {
  invalidatePreviewAssetCache,
  clearCachedPreviewDetail,
} from "../utils/previewCache";
import { syncAfterFileMutation } from "../services/fileStateSync";
import { PlatformAlert as Alert } from "../utils/alert";

export default function FileToolsScreen({ route, navigation }: any) {
  const file = route.params.file;
  const { user, token } = useContext(AuthContext)!;
  const { showToast } = useToast();
  const { theme } = useTheme();
  const [offline, setOffline] = useState(false),
    [tags, setTags] = useState<string[]>([]),
    [tag, setTag] = useState(""),
    [versions, setVersions] = useState<any[]>([]),
    [sources, setSources] = useState<any[] | null>(null),
    [sourceQuery, setSourceQuery] = useState(""),
    [sourcePage, setSourcePage] = useState(0),
    [sourceMore, setSourceMore] = useState(false),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    setOffline((await listOfflineFiles(user.id)).some((f) => f.id === file.id));
    const result = await Promise.allSettled([
      apiClient.get(`/files/${file.id}/tags`),
      apiClient.get(`/files/${file.id}/versions`),
    ]);
    result.forEach((r, i) => {
      if (r.status === "fulfilled") {
        if (i === 0) setTags(r.value.data.tags);
        else setVersions(r.value.data.versions);
      } else
        showToast(
          "Some file tools could not load. Retry when online.",
          "error",
        );
    });
  };
  useEffect(() => {
    void refresh().catch(() => {});
  }, [file.id, user.id]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (e: any) {
      showToast(e.response?.data?.message || e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const change = (body: any) =>
    run(async () => {
      await apiClient.post(`/files/${file.id}/versions`, body);
      invalidatePreviewAssetCache(API_BASE, file.id);
      clearCachedPreviewDetail(file.id);
      syncAfterFileMutation();
      setSources(null);
      showToast(
        "Version updated. Existing shared links retain the copy originally shared.",
      );
    });
  const findSources = (page = 0) => run(async () => {
    const { data } = await apiClient.get("/files/discover", { params: { q: sourceQuery, mime: file.mime_type, page } });
    const matches = data.files.filter((f: any) => f.id !== file.id && f.mime_type === file.mime_type);
    setSources(old => page ? [...(old || []), ...matches] : matches);
    setSourcePage(page);
    setSourceMore(data.hasMore);
  });
  return (
    <ToolPage
      title="File tools"
      subtitle={file.name || file.file_name}
      navigation={navigation}
    >
      {busy && <ActivityIndicator color={theme.colors.primary} />}
      <ToolRow
        title={offline ? "Remove offline copy" : "Make available offline"}
        detail={
          offline
            ? "Keeps the original in Telegram"
            : "Verified download saved only on this device"
        }
        disabled={busy}
        onPress={() =>
          run(async () => {
            if (offline) await removeOfflineFile(user.id, file.id);
            else await saveOfflineFile(user.id, file.id, token!);
            showToast(
              offline ? "Offline copy removed" : "File available offline",
            );
          })
        }
      />
      <Text
        style={{
          color: theme.colors.textHeading,
          fontFamily: "Inter_600SemiBold",
        }}
      >
        Tags
      </Text>
      <ToolInput
        value={tag}
        onChangeText={setTag}
        maxLength={64}
        placeholder="e.g. invoices"
        autoCapitalize="none"
      />
      <ToolRow
        title="Add tag"
        disabled={busy || !tag.trim()}
        onPress={() =>
          run(async () => {
            await apiClient.post(`/files/${file.id}/tags`, { tag: tag.trim() });
            setTag("");
          })
        }
      />
      {tags.map((t) => (
        <ToolRow
          key={t}
          title={`#${t}`}
          detail="Tap to remove tag"
          disabled={busy}
          onPress={() =>
            run(async () => {
              await apiClient.delete(
                `/files/${file.id}/tags/${encodeURIComponent(t)}`,
              );
            })
          }
        />
      ))}
      <Text
        style={{
          color: theme.colors.textHeading,
          fontFamily: "Inter_600SemiBold",
        }}
      >
        Versions
      </Text>
      <ToolRow
        title="Use an uploaded file as a new version"
        detail="Choose a file of the same type already in your drive. The current version is kept for recovery."
        disabled={busy}
        onPress={() => void findSources()}
      />
      {sources && <>
        <ToolInput placeholder="Find a replacement file" value={sourceQuery} onChangeText={(value: string) => { setSourceQuery(value); setSourceMore(false); }} onSubmitEditing={() => void findSources()} />
        <ToolRow title="Find files of the same type" disabled={busy} onPress={() => void findSources()} />
        {!sources.length && <Text style={{ color: theme.colors.textBody }}>No matching files. Upload another file of this type first.</Text>}
      </>}
      {sources?.map((f) => (
        <ToolRow
          key={f.id}
          title={f.name}
          detail="Use as the latest version"
          disabled={busy}
          onPress={() =>
            Alert.alert(
              "Replace file content?",
              `Keep “${file.name}” in its folder and use the contents of “${f.name}”. The previous content will remain in version history.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Replace",
                  onPress: () => void change({ sourceFileId: f.id }),
                },
              ],
            )
          }
        />
      ))}
      {sources && sourceMore && <ToolRow title="Load more replacement files" disabled={busy} onPress={() => void findSources(sourcePage + 1)} />}
      {versions.map((v) => (
        <ToolRow
          key={v.id}
          title={new Date(v.created_at).toLocaleString()}
          detail={`${v.name} · ${(Number(v.size) / 1024).toFixed(1)} KB · Tap to restore`}
          disabled={busy}
          onPress={() =>
            Alert.alert(
              "Restore this version?",
              "The current content will also be saved in version history.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Restore",
                  onPress: () => void change({ versionId: v.id }),
                },
              ],
            )
          }
        />
      ))}
      {!versions.length && (
        <Text style={{ color: theme.colors.textBody }}>
          Previous versions appear here after you replace file content.
        </Text>
      )}
    </ToolPage>
  );
}
