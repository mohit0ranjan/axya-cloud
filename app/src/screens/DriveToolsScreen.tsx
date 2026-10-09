import React, { useContext, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Switch, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { AuthContext } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { useUpload } from "../context/UploadContext";
import { uploadManager } from "../services/UploadManager";
import { nativeTransfer } from "../services/nativeTransfer";
import apiClient from "../services/apiClient";
import { ToolPage, ToolRow } from "../components/DriveToolLayout";

export default function DriveToolsScreen({ navigation }: any) {
  const { user } = useContext(AuthContext)!;
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { addUpload } = useUpload();
  const [busy, setBusy] = useState("");
  const [prefs, setPrefs] = useState({ wifiOnly: false, chargingOnly: false });
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(`@transfer_constraints:${user.id}`)
      .then((v) => {
        if (alive && v) setPrefs(JSON.parse(v));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user.id]);
  const run = async (name: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(name);
    try {
      await work();
    } catch (e: any) {
      showToast(e.message || "Could not complete this action.", "error");
    } finally {
      setBusy("");
    }
  };
  const setting = (field: "wifiOnly" | "chargingOnly", value: boolean) =>
    run("settings", async () => {
      const next = { ...prefs, [field]: value };
      await uploadManager.setTransferConstraints(
        next.wifiOnly,
        next.chargingOnly,
      );
      setPrefs(next);
    });
  const scan = () =>
    run("scanner", async () => {
      if (!nativeTransfer)
        throw new Error("Document scanning needs the new Android build.");
      const result = await nativeTransfer.scanDocument();
      if (!result) return;
      const scan = JSON.parse(result);
      addUpload({
        uri: scan.uri,
        name: `Scan ${new Date().toISOString().slice(0, 10)} ${Date.now()}.pdf`,
        size: 0,
        mimeType: "application/pdf",
      });
      showToast(`${scan.pages} pages added to uploads.`);
    });
  const exportData = () =>
    run("export", async () => {
      let page = 0,
        more = true;
      const files: any[] = [],
        folders: any[] = [];
      while (more) {
        const { data } = await apiClient.get("/files/export-manifest", {
          params: { page },
        });
        files.push(...data.files);
        folders.push(...data.folders);
        more = data.hasMore;
        page++;
        if (page > 1000)
          throw new Error("Export is too large. Contact support.");
      }
      const text = JSON.stringify(
        {
          format: "axya-manifest-v1",
          exportedAt: new Date().toISOString(),
          files,
          folders,
        },
        null,
        2,
      );
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(
          new Blob([text], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "Axya-file-manifest.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const file = new File(Paths.cache, "Axya-file-manifest.json");
        file.write(text);
        await Sharing.shareAsync(file.uri, { mimeType: "application/json" });
      }
      showToast("File names, folders and checksums exported.");
    });
  return (
    <ToolPage
      title="Drive tools"
      subtitle="Keep files available, organise your drive and control transfers."
      navigation={navigation}
    >
      {!!busy && (
        <ActivityIndicator
          color={theme.colors.primary}
          accessibilityLabel={`Working on ${busy}`}
        />
      )}
      <ToolRow
        title="Offline files"
        detail="Open saved copies without internet"
        onPress={() => navigation.navigate("OfflineFiles")}
      />
      <ToolRow
        title="Photo backup"
        detail="Choose an album and a destination folder"
        onPress={() => navigation.navigate("PhotoBackup")}
      />
      <ToolRow
        title="Scan a document"
        detail={
          nativeTransfer
            ? "Crop, clean up and save multiple pages as PDF"
            : "Available in the Android build"
        }
        onPress={scan}
        disabled={!!busy || !nativeTransfer}
      />
      <ToolRow
        title="Upload files"
        detail="Add documents, photos or videos"
        disabled={!!busy}
        onPress={() =>
          run("picker", async () => {
            const result = await DocumentPicker.getDocumentAsync({
              multiple: true,
              copyToCacheDirectory: true,
            });
            if (!result.canceled)
              addUpload(
                result.assets.map((f) => ({ ...f, size: f.size || 0 })),
              );
          })
        }
      />
      <ToolRow
        title="Collections & advanced search"
        detail="Photos, audio, large files, dates and tags"
        onPress={() => navigation.navigate("Discover")}
      />
      <ToolRow
        title="Bulk rename"
        detail="Preview new names, then apply or undo"
        onPress={() => navigation.navigate("BulkOrganise")}
      />
      <ToolRow
        title="File requests"
        detail="Let someone send files into a chosen folder"
        onPress={() => navigation.navigate("FileRequests")}
      />
      <ToolRow
        title="Recovery centre"
        detail="Check drive health and missing files"
        onPress={() => navigation.navigate("DriveHealth")}
      />
      <ToolRow
        title="Export file manifest"
        detail="Download your folder structure, file names and checksums. File contents are downloaded separately."
        disabled={!!busy}
        onPress={exportData}
      />
      <Text
        style={{
          color: theme.colors.textBody,
          fontFamily: "Inter_600SemiBold",
          marginTop: 12,
        }}
      >
        Transfer preferences
      </Text>
      <ToolRow
        title="Unmetered networks only"
        detail="Wait for Wi-Fi or another unmetered connection"
        disabled={!!busy || !nativeTransfer}
        right={
          <Switch
            accessibilityLabel="Unmetered networks only"
            disabled={!!busy || !nativeTransfer}
            value={prefs.wifiOnly}
            onValueChange={(v) => setting("wifiOnly", v)}
          />
        }
      />
      <ToolRow
        title="Upload while charging"
        detail="The Android worker waits until the phone is plugged in"
        disabled={!!busy || !nativeTransfer}
        right={
          <Switch
            accessibilityLabel="Upload while charging"
            disabled={!!busy || !nativeTransfer}
            value={prefs.chargingOnly}
            onValueChange={(v) => setting("chargingOnly", v)}
          />
        }
      />
    </ToolPage>
  );
}
