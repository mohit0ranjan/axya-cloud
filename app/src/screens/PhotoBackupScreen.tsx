import React, { useContext, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Text } from "react-native";
import { AuthContext } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";
import { nativeTransfer } from "../services/nativeTransfer";
import { ToolPage, ToolRow } from "../components/DriveToolLayout";
import apiClient from "../services/apiClient";
export default function PhotoBackupScreen({ navigation }: any) {
  const { user } = useContext(AuthContext)!;
  const { showToast } = useToast();
  const { theme } = useTheme();
  const [albums, setAlbums] = useState<any[]>([]),
    [folders, setFolders] = useState<any[]>([]),
    [album, setAlbum] = useState(""),
    [folder, setFolder] = useState<string | null>(null),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    nativeTransfer
      ?.backupStatus(user.id)
      .then((v) => {
        const p = JSON.parse(v || "{}");
        setAlbum(p.album || "");
        setFolder(p.folder || null);
        setEnabled(!!p.enabled);
        setError(p.error || "");
      })
      .catch(() => {});
  }, [user.id]);
  const choose = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (Platform.OS !== "android" || !nativeTransfer)
        throw new Error("Album backup needs the new Android build.");
      const media = await import("expo-media-library");
      const permission = await media.requestPermissionsAsync(false, ["photo"]);
      if (!permission.granted)
        throw new Error("Allow photo access to choose an album.");
      setAlbums(await media.getAlbumsAsync());
      const { data } = await apiClient.get("/files/folders");
      setFolders(data.folders || []);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const save = async (value: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await nativeTransfer!.configureBackup(user.id, album, folder, value);
      setEnabled(value);
      setError("");
      showToast(value ? "Photo backup enabled" : "Photo backup stopped");
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ToolPage
      title="Photo backup"
      subtitle="Keep photos from your chosen album together."
      navigation={navigation}
    >
      {busy && <ActivityIndicator color={theme.colors.primary} />}
      <ToolRow
        title="Choose an album"
        detail="Photo permission is requested only when you tap here"
        disabled={busy || !nativeTransfer}
        onPress={() => void choose()}
      />
      {albums.map((a) => (
        <ToolRow
          key={a.id}
          title={a.title}
          selected={album === a.id}
          selectionMode="single"
          detail={`${a.assetCount} photos and videos · photos are backed up`}
          disabled={busy}
          onPress={() => setAlbum(a.id)}
        />
      ))}
      <Text
        style={{
          color: theme.colors.textHeading,
          fontFamily: "Inter_600SemiBold",
        }}
      >
        Destination
      </Text>
      <ToolRow
        title="All files"
        selected={folder === null}
        selectionMode="single"
        disabled={busy}
        onPress={() => setFolder(null)}
      />
      {folders.map((f) => (
        <ToolRow
          key={f.id}
          title={f.name}
          selected={folder === f.id}
          selectionMode="single"
          disabled={busy}
          onPress={() => setFolder(f.id)}
        />
      ))}
      <ToolRow
        title={enabled ? "Update backup settings" : "Enable photo backup"}
        detail="Existing photos are added in batches of 100. Failed uploads stay in Transfers for recovery."
        disabled={busy || !album || !nativeTransfer}
        onPress={() => void save(true)}
      />
      {enabled && (
        <ToolRow
          title="Stop photo backup"
          detail="Stops future scans. Already queued uploads can be paused or cancelled in Transfers."
          disabled={busy}
          onPress={() => void save(false)}
        />
      )}
      <ToolRow
        title="Wi-Fi & charging preferences"
        detail="These drive-wide preferences also apply to photo backup"
        onPress={() => navigation.navigate("DriveTools")}
      />
      {!!error && <Text style={{ color: theme.colors.danger }}>{error}</Text>}
    </ToolPage>
  );
}
