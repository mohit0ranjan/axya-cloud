import { PlatformAlert as Alert } from "../utils/alert";
/**
 * TrashScreen.tsx — Trash files using FileListItem for consistency
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Info,
  Search,
  X,
  RotateCcw,
  Trash2,
} from "lucide-react-native";
import { useTheme } from "../context/ThemeContext";
import apiClient from "../services/apiClient";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import FileListItem from "../components/FileListItem";
import { FileCardSkeleton, ContentFadeIn } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { useFileRefresh } from "../utils/events";
import {
  dedupeFilesById,
  sortFilesLatestFirst,
  syncAfterFileMutation,
} from "../services/fileStateSync";
import { sanitizeDisplayName } from "../utils/fileSafety";
import { useReducedMotion } from "../hooks/useReducedMotion";

export default function TrashScreen({ navigation }: any) {
  const { theme, isDark } = useTheme();
  const C = theme.colors;
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { token } = useAuth();
  const reducedMotion = useReducedMotion();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isEmptying, setIsEmptying] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [files, setFiles] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [optionsTarget, setOptionsTarget] = useState<any>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  const loadTrash = useCallback(async () => {
    setLoadError("");
    try {
      const res = await apiClient.get("/files/trash");
      if (res.data?.success) {
        setFiles(sortFilesLatestFirst(dedupeFilesById(res.data.files || [])));
      } else {
        setFiles([]);
        setLoadError(res.data?.error || "Could not load trash.");
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.error ||
        "Could not load trash. Check your connection and retry.";
      setLoadError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (reducedMotion) {
      fadeAnim.stopAnimation();
      fadeAnim.setValue(1);
    } else
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }).start();
  }, [fadeAnim, reducedMotion]);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  useFileRefresh(() => {
    void loadTrash();
  });

  const deletedCountLabel = useMemo(() => {
    return files.length === 1 ? "1 file" : `${files.length} files`;
  }, [files.length]);
  const visibleFiles = useMemo(
    () =>
      files.filter((file) =>
        String(file.name || file.file_name || "")
          .toLowerCase()
          .includes(searchQuery.trim().toLowerCase()),
      ),
    [files, searchQuery],
  );

  const isBusy = isEmptying || pendingActionId !== null;

  const handleRestore = useCallback(
    async (item: any) => {
      setPendingActionId(item.id);
      try {
        const res = await apiClient.patch(`/files/${item.id}/restore`);
        if (!res.data?.success)
          throw new Error(res.data?.error || "Could not restore file");
        setFiles((prev) => prev.filter((file) => file.id !== item.id));
        syncAfterFileMutation({ clearCache: true });
        await loadTrash();
        showToast("File restored");
      } catch (err: any) {
        const message =
          err?.response?.data?.error ||
          err?.message ||
          "Could not restore file";
        setLoadError(message);
        showToast(message, "error");
        await loadTrash();
      } finally {
        setPendingActionId(null);
      }
    },
    [loadTrash, showToast],
  );

  const handleDeleteForever = useCallback(
    (item: any) => {
      const label = sanitizeDisplayName(
        item.name || item.file_name || "this file",
        "this file",
      );
      Alert.alert(
        "Delete permanently",
        `Delete "${label}" permanently? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              setPendingActionId(item.id);
              setLoadError("");
              try {
                const res = await apiClient.post("/files/bulk", {
                  ids: [item.id],
                  action: "delete",
                });
                if (!res.data?.success)
                  throw new Error(res.data?.error || "Could not delete file");
                setFiles((prev) => prev.filter((file) => file.id !== item.id));
                syncAfterFileMutation({ clearCache: true });
                showToast("File deleted permanently");
              } catch (err: any) {
                const serverMsg =
                  err?.response?.data?.message ||
                  err?.response?.data?.error ||
                  err?.message ||
                  "";
                const isConstraintError =
                  serverMsg.includes("constraint") ||
                  serverMsg.includes("share data");
                const displayMsg = isConstraintError
                  ? "This file has linked share data that was cleaned up. Please try again."
                  : serverMsg || "Could not delete file. Please retry.";

                setLoadError(displayMsg);
                showToast(
                  isConstraintError
                    ? "Share data cleaned up — please retry"
                    : displayMsg,
                  "error",
                );

                // Always refresh the list to show accurate state
                await loadTrash();
              } finally {
                setPendingActionId(null);
              }
            },
          },
        ],
      );
    },
    [loadTrash, showToast],
  );

  const handleEmptyTrash = useCallback(() => {
    if (files.length === 0 || isBusy) return;
    Alert.alert(
      "Empty trash",
      "Delete all trashed files permanently? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Empty trash",
          style: "destructive",
          onPress: async () => {
            setIsEmptying(true);
            setLoadError("");
            try {
              const res = await apiClient.delete("/files/trash");
              if (res.data?.success) {
                setFiles([]);
                syncAfterFileMutation({ clearCache: true });
                showToast(res.data.message || "Trash emptied");
              } else {
                throw new Error(
                  res.data?.error || "Could not empty trash completely",
                );
              }
            } catch (err: any) {
              const serverMsg =
                err?.response?.data?.message ||
                err?.response?.data?.error ||
                err?.message ||
                "";
              const isConstraintError =
                serverMsg.includes("constraint") ||
                serverMsg.includes("share data");
              const displayMsg = isConstraintError
                ? "Some files had linked shares that were cleaned up. Please try emptying trash again."
                : serverMsg || "Could not empty trash. Please retry.";

              setLoadError(displayMsg);
              showToast(
                isConstraintError
                  ? "Share data cleaned — retry to finish"
                  : displayMsg,
                "error",
              );
            } finally {
              // Always refresh to show accurate state
              await loadTrash();
              setIsEmptying(false);
            }
          },
        },
      ],
    );
  }, [files.length, isBusy, loadTrash, showToast]);

  const handleBack = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation?.navigate?.("MainTabs", { screen: "Home" });
  }, [navigation]);

  // Show trash-specific options inline (Restore + Delete Forever)
  const handleTrashOptions = useCallback(
    (item: any) => setOptionsTarget(item),
    [],
  );

  return (
    <View
      style={[
        st.root,
        { backgroundColor: C.background, paddingTop: insets.top },
      ]}
    >
      {/* Header — matches AllFiles/Starred pattern */}
      <View
        style={[
          st.header,
          { backgroundColor: C.background, borderBottomColor: C.border },
        ]}
      >
        <TouchableOpacity
          style={st.iconBtn}
          onPress={handleBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft color={C.textHeading} size={24} />
        </TouchableOpacity>
        <View style={st.headerInfo}>
          <Text
            style={[st.headerTitle, { color: C.textHeading }]}
            numberOfLines={1}
          >
            Trash
          </Text>
          <Text style={[st.headerSub, { color: C.textBody }]} numberOfLines={1}>
            {deletedCountLabel}
          </Text>
        </View>
        <TouchableOpacity
          style={st.emptyBtn}
          activeOpacity={files.length === 0 || isBusy ? 1 : 0.7}
          disabled={files.length === 0 || isBusy}
          onPress={handleEmptyTrash}
          accessibilityRole="button"
          accessibilityLabel="Empty trash"
        >
          {isBusy ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <ActivityIndicator size="small" color="#EF4444" />
              <Text
                style={{ color: "#EF4444", fontWeight: "700", fontSize: 14 }}
              >
                {isEmptying ? "Emptying" : "Working"}
              </Text>
            </View>
          ) : (
            <Text
              style={{
                color: files.length === 0 ? C.border : "#EF4444",
                fontWeight: "700",
                fontSize: 14,
              }}
            >
              Empty trash
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <View
        style={[
          st.searchBar,
          { backgroundColor: C.card, borderColor: C.border },
        ]}
      >
        <Search size={18} color={C.textBody} />
        <TextInput
          style={[st.searchInput, { color: C.textHeading }]}
          placeholder="Search trash"
          placeholderTextColor={C.textBody}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search trash"
        />
        {!!searchQuery && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            style={st.searchClear}
            onPress={() => setSearchQuery("")}
          >
            <X size={18} color={C.textBody} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={{ padding: 20 }}>
          {[0, 1, 2, 3].map((key) => (
            <FileCardSkeleton key={key} index={key} />
          ))}
        </View>
      ) : loadError && files.length === 0 ? (
        <ErrorState
          title="Trash unavailable"
          message={loadError}
          onRetry={() => {
            setLoading(true);
            void loadTrash();
          }}
        />
      ) : (
        <Animated.View style={[st.content, { opacity: fadeAnim }]}>
          {!!loadError && files.length > 0 && (
            <View
              style={[
                st.errorBanner,
                { backgroundColor: C.card, borderColor: C.danger + "33" },
              ]}
            >
              <Text
                style={[st.errorBannerText, { color: C.danger }]}
                numberOfLines={2}
              >
                {loadError}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setRefreshing(true);
                  void loadTrash();
                }}
              >
                <Text style={{ color: C.primary, fontWeight: "700" }}>
                  Retry
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Warning Banner */}
          <View
            style={[
              st.infoCard,
              {
                backgroundColor: C.primary + "10",
                borderColor: C.primary + "25",
              },
            ]}
          >
            <Info color={C.primary} size={20} />
            <Text style={[st.infoText, { color: C.textBody }]}>
              Items stay in Trash until you restore or permanently delete them.
            </Text>
          </View>

          {visibleFiles.length === 0 ? (
            <EmptyState
              title={searchQuery ? "No matching items" : "Trash is empty"}
              description={
                searchQuery
                  ? "Try a different name"
                  : "Deleted files will appear here until you restore them or empty the trash."
              }
              iconType={searchQuery ? "search" : "file"}
              buttonText={searchQuery ? "Clear search" : undefined}
              onButtonPress={searchQuery ? () => setSearchQuery("") : undefined}
              style={st.emptyState}
            />
          ) : (
            <FlatList
              data={visibleFiles}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <FileListItem
                  variant="library"
                  item={item}
                  token={token || ""}
                  apiBaseUrl={apiClient.defaults.baseURL || ""}
                  theme={theme}
                  isDark={isDark}
                  onPress={() => handleTrashOptions(item)}
                  onOptionsPress={handleTrashOptions}
                />
              )}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={st.list}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  tintColor={C.primary}
                  onRefresh={() => {
                    setRefreshing(true);
                    void loadTrash();
                  }}
                />
              }
              windowSize={10}
              maxToRenderPerBatch={20}
              removeClippedSubviews
            />
          )}
        </Animated.View>
      )}
      <Modal
        visible={!!optionsTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setOptionsTarget(null)}
      >
        <Pressable
          style={st.sheetOverlay}
          onPress={() => setOptionsTarget(null)}
        >
          <Pressable
            style={[st.sheet, { backgroundColor: C.card }]}
            onPress={(event: any) => event?.stopPropagation?.()}
          >
            <View style={[st.sheetHandle, { backgroundColor: C.border }]} />
            <Text
              style={[st.sheetTitle, { color: C.textHeading }]}
              numberOfLines={2}
            >
              {sanitizeDisplayName(
                optionsTarget?.name || optionsTarget?.file_name || "Item",
                "Item",
              )}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Restore item"
              style={st.sheetAction}
              disabled={isBusy}
              onPress={() => {
                const target = optionsTarget;
                setOptionsTarget(null);
                void handleRestore(target);
              }}
            >
              <RotateCcw size={20} color={C.primary} />
              <Text style={[st.sheetActionText, { color: C.textHeading }]}>
                Restore
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Delete item permanently"
              style={st.sheetAction}
              disabled={isBusy}
              onPress={() => {
                const target = optionsTarget;
                setOptionsTarget(null);
                setTimeout(() => handleDeleteForever(target), 250);
              }}
            >
              <Trash2 size={20} color={C.danger} />
              <Text style={[st.sheetActionText, { color: C.danger }]}>
                Delete permanently
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginVertical: 12,
    paddingHorizontal: 14,
    height: 56,
    borderWidth: 1,
    borderRadius: 28,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    minWidth: 0,
  },
  searchClear: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.42)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 18,
  },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 16 },
  sheetAction: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  sheetActionText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 0,
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 18,
    minHeight: 72,
  },
  iconBtn: { justifyContent: "center", width: 44, height: 44 },
  headerInfo: { flex: 1 },
  headerTitle: {
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.6,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  headerSub: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
    fontFamily: "Inter_500Medium",
  },
  emptyBtn: {
    paddingHorizontal: 12,
    height: 34,
    justifyContent: "center",
    minHeight: 44,
    borderRadius: 12,
  },
  content: { flex: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    gap: 12,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 20,
    borderRadius: 14,
    padding: 16,
  },
  infoText: {
    flex: 1,
    fontWeight: "500",
    fontSize: 13,
    lineHeight: 21,
    fontFamily: "Inter_500Medium",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    fontFamily: "Inter_600SemiBold",
  },
  emptyState: { flex: 1, paddingHorizontal: 20, paddingBottom: 56 },
});
