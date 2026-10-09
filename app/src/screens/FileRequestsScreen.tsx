import React, { useEffect, useState } from "react";
import { Platform, Share, Text } from "react-native";
import { ToolPage, ToolRow, ToolInput } from "../components/DriveToolLayout";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";
import apiClient from "../services/apiClient";
import { PlatformAlert as Alert } from "../utils/alert";
export default function FileRequestsScreen({ navigation }: any) {
  const { showToast } = useToast();
  const { theme } = useTheme();
  const [folders, setFolders] = useState<any[]>([]),
    [folder, setFolder] = useState(""),
    [title, setTitle] = useState("Send me files"),
    [password, setPassword] = useState(""),
    [requests, setRequests] = useState<any[]>([]),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    const [f, r] = await Promise.all([
      apiClient.get("/files/folders"),
      apiClient.get("/file-requests"),
    ]);
    setFolders(f.data.folders || []);
    setRequests(r.data.requests || []);
  };
  useEffect(() => {
    void refresh().catch(() =>
      showToast("File requests could not load. Retry when online.", "error"),
    );
  }, []);
  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await apiClient.post("/file-requests", {
        title,
        folderId: folder,
        expiresInDays: 7,
        maxMB: 100,
        maxFiles: 20,
        password: password || undefined,
      });
      setUrl(data.url);
      setPassword("");
      await refresh();
    } catch (e: any) {
      showToast(
        e.response?.data?.message || "Could not create file request.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    try {
      if (Platform.OS === "web") await navigator.clipboard.writeText(url);
      else await Share.share({ message: url });
      showToast(Platform.OS === "web" ? "Link copied" : "Share sheet opened");
    } catch {
      showToast("Could not share. Copy the link shown below.", "error");
    }
  };
  const revoke = async (slug: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiClient.delete(`/file-requests/${slug}`);
      await refresh();
      showToast("File request revoked");
    } catch {
      showToast("Could not revoke request.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ToolPage
      title="File requests"
      subtitle="Friends can upload into your selected folder through the web. They cannot browse or download your drive."
      navigation={navigation}
    >
      <ToolInput
        value={title}
        onChangeText={setTitle}
        placeholder="Request title"
        maxLength={100}
      />
      <ToolInput
        value={password}
        onChangeText={setPassword}
        placeholder="Optional password (8+ characters)"
        secureTextEntry
        maxLength={128}
      />
      <Text
        style={{
          color: theme.colors.textHeading,
          fontFamily: "Inter_600SemiBold",
        }}
      >
        Destination folder
      </Text>
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
        title="Create request link"
        detail="Expires in 7 days · 20 files · 100 MB total. Create a new folder first if needed."
        disabled={
          busy ||
          !folder ||
          !title.trim() ||
          (!!password && password.length < 8)
        }
        onPress={() => void create()}
      />
      {!!url && (
        <>
          <Text
            selectable
            style={{ color: theme.colors.primary, lineHeight: 22 }}
          >
            {url}
          </Text>
          <ToolRow
            title="Share this link"
            detail="Save it now. Its private key cannot be retrieved later."
            onPress={() => void share()}
          />
        </>
      )}
      {requests.map((r) => (
        <ToolRow
          key={r.id}
          title={r.title}
          detail={`${r.files_received} upload reservations · ${r.revoked_at ? "Revoked" : new Date(r.expires_at) < new Date() ? "Expired" : `Expires ${new Date(r.expires_at).toLocaleDateString()}`} · Tap to revoke`}
          disabled={busy || !!r.revoked_at}
          onPress={() =>
            Alert.alert(
              "Revoke request?",
              "This stops new access. Files already being finalised may finish uploading.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Revoke",
                  style: "destructive",
                  onPress: () => void revoke(r.slug),
                },
              ],
            )
          }
        />
      ))}
    </ToolPage>
  );
}
