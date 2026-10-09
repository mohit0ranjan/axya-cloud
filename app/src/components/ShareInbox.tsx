import React, { useEffect, useState } from "react";
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { nativeTransfer } from "../services/nativeTransfer";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { useUpload } from "../context/UploadContext";
import apiClient from "../services/apiClient";
export default function ShareInbox({ owner }: { owner: string | null }) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { addUpload } = useUpload();
  const [files, setFiles] = useState<any[]>([]),
    [folders, setFolders] = useState<any[]>([]),
    [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    setFiles([]);
    setFolder(null);
    if (!owner || !nativeTransfer) return;
    let alive = true;
    const consume = () => {
      nativeTransfer!
        .consumeShares()
        .then((v) => {
          const f = JSON.parse(v);
          if (alive && f.length) {
            setFiles(f);
            void apiClient
              .get("/files/folders")
              .then((r) => {
                if (alive) setFolders(r.data.folders || []);
              })
              .catch(() => {});
          }
        })
        .catch(() =>
          showToast(
            "Shared files could not be opened. Try sharing them again.",
            "error",
          ),
        );
    };
    consume();
    const listener = nativeTransfer.addListener("incomingShare", consume);
    const foreground = AppState.addEventListener("change", (s) => {
      if (s === "active") consume();
    });
    return () => {
      alive = false;
      listener.remove();
      foreground.remove();
    };
  }, [owner]);
  return (
    <Modal
      visible={files.length > 0}
      transparent
      animationType="slide"
      onRequestClose={() => setFiles([])}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0,0,0,.35)",
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.card,
            padding: 24,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            maxHeight: "80%",
            gap: 16,
          }}
        >
          <Text
            style={{
              color: theme.colors.textHeading,
              fontSize: 22,
              fontFamily: "Inter_700Bold",
            }}
          >
            Save {files.length} shared files
          </Text>
          <Text style={{ color: theme.colors.textBody }}>
            Choose where these files should go.
          </Text>
          <ScrollView style={{ maxHeight: 240 }}>
            {[{ id: null, name: "All files" }, ...folders].map((f) => (
              <Pressable
                key={f.id || "root"}
                onPress={() => setFolder(f.id)}
                style={{
                  padding: 16,
                  backgroundColor:
                    folder === f.id
                      ? theme.colors.primaryLight
                      : theme.colors.card,
                  borderRadius: 14,
                }}
              >
                <Text style={{ color: theme.colors.textHeading }}>
                  {folder === f.id ? "✓ " : ""}
                  {f.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              addUpload(files, folder);
              setFiles([]);
              showToast("Shared files added to transfers.");
            }}
            style={{
              backgroundColor: theme.colors.primary,
              padding: 18,
              borderRadius: 18,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "white", fontFamily: "Inter_600SemiBold" }}>
              Upload to Axya
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFiles([])}
            style={{ padding: 14, alignItems: "center" }}
          >
            <Text style={{ color: theme.colors.textBody }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
