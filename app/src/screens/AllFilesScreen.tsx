import { SafeAreaView } from "react-native-safe-area-context";
import { LibraryShortcut } from "../components/LibraryUI";
import { SearchCheck, CloudDownload } from "lucide-react-native";
/**
 * AllFilesScreen.tsx – Shows all individual files across all folders
 * Updated: sort functionality, standardized tokens, consistent header
 */
import React, {
  useState,
  useEffect,
  useContext,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import {
  ArrowLeft,
  Search,
  X,
  SortAsc,
  SortDesc,
  Filter,
} from "lucide-react-native";
import { AuthContext } from "../context/AuthContext";
import apiClient from "../services/apiClient";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";
import { FileCardSkeleton, ContentFadeIn } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import FileListItem from "../components/FileListItem";
import FileQuickActions from "../components/FileQuickActions";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFileRefresh, useOptimisticFiles } from "../utils/events";
import { normalizeItems, sortItems } from "../services/fileStateSync";
import { appendUniqueFiles, filePageUrl } from "../utils/filePages";

const SORT_OPTIONS = [
  { key: "created_at_DESC", label: "Newest First", icon: SortDesc },
  { key: "created_at_ASC", label: "Oldest First", icon: SortAsc },
  { key: "file_name_ASC", label: "Name A→Z", icon: SortAsc },
  { key: "file_name_DESC", label: "Name Z→A", icon: SortDesc },
  { key: "file_size_DESC", label: "Largest First", icon: SortDesc },
  { key: "file_size_ASC", label: "Smallest First", icon: SortAsc },
];

export default function AllFilesScreen({ navigation }: any) {
  const { token } = useContext(AuthContext);
  const { showToast } = useToast();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const C = theme.colors;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [files, setFiles] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [serverTotal, setServerTotal] = useState(0);
  const [loadedFileCount, setLoadedFileCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const loadingMoreRef = useRef(false);
  const requestGeneration = useRef(0);
  const [optionsTarget, setOptionsTarget] = useState<any>(null);
  const [sortKey, setSortKey] = useState("created_at_DESC");
  const [showSortModal, setShowSortModal] = useState(false);
  const mountedRef = useRef(true);

  const fetchFiles = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setLoadError("");
    setPageError(false);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    try {
      const res = await apiClient.get(
        filePageUrl({ sortKey, query: debouncedQuery, offset: 0 }),
      );
      if (!res.data.success) throw new Error("Could not load files");
      if (mountedRef.current && generation === requestGeneration.current) {
        setFiles(normalizeItems(res.data.files || [], sortKey as any));
        setLoadedFileCount((res.data.files || []).length);
        setServerTotal(Number(res.data.total_count) || 0);
      }
    } catch {
      if (mountedRef.current && generation === requestGeneration.current) {
        setLoadError(
          "Could not load files. Check your connection and try again.",
        );
        showToast("Could not load files", "error");
      }
    } finally {
      if (mountedRef.current && generation === requestGeneration.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [showToast, sortKey, debouncedQuery]);

  const fetchMoreFiles = useCallback(
    async (retry = false) => {
      if (
        loading ||
        loadingMoreRef.current ||
        (pageError && !retry) ||
        loadedFileCount >= serverTotal
      )
        return;
      const generation = requestGeneration.current;
      loadingMoreRef.current = true;
      setLoadingMore(true);
      try {
        const response = await apiClient.get(
          filePageUrl({
            sortKey,
            query: debouncedQuery,
            offset: loadedFileCount,
          }),
        );
        if (!response.data.success)
          throw new Error("Could not load more files");
        if (!mountedRef.current || generation !== requestGeneration.current)
          return;
        const page = response.data.files || [];
        setFiles((current) =>
          sortItems(appendUniqueFiles(current, page), sortKey as any),
        );
        setLoadedFileCount((count) => count + page.length);
        setServerTotal(Number(response.data.total_count) || 0);
        if (page.length === 0 && loadedFileCount < serverTotal)
          setPageError(true);
      } catch {
        if (mountedRef.current && generation === requestGeneration.current)
          setPageError(true);
      } finally {
        if (mountedRef.current && generation === requestGeneration.current) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [loading, pageError, loadedFileCount, serverTotal, sortKey, debouncedQuery],
  );

  useEffect(() => {
    const timeout = setTimeout(
      () => setDebouncedQuery(searchQuery.trim()),
      250,
    );
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      ++requestGeneration.current;
    };
  }, []);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  useFileRefresh(() => {
    fetchFiles();
  });
  useOptimisticFiles(
    setFiles,
    (file) =>
      !debouncedQuery ||
      String(file.name || file.file_name || "")
        .toLowerCase()
        .includes(debouncedQuery.toLowerCase()),
  );

  const sortedFiles = useMemo(
    () => sortItems(files, sortKey as any),
    [files, sortKey],
  );

  const filteredFiles = sortedFiles;

  const currentSort =
    SORT_OPTIONS.find((s) => s.key === sortKey) ?? SORT_OPTIONS[0];

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFiles();
  }, [fetchFiles]);

  const handleBack = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation?.navigate?.("MainTabs", { screen: "Home" });
  }, [navigation]);

  const renderFile = useCallback(
    ({ item }: any) => (
      <FileListItem
        variant="library"
        item={item}
        token={token}
        apiBaseUrl={apiClient.defaults.baseURL || ""}
        theme={theme}
        isDark={isDark}
        onPress={() => {
          const idx = filteredFiles.findIndex((f) => f.id === item.id);
          navigation.navigate("FilePreview", {
            files: filteredFiles,
            initialIndex: idx === -1 ? 0 : idx,
          });
        }}
        onOptionsPress={(item) => setOptionsTarget(item)}
      />
    ),
    [filteredFiles, navigation, theme, isDark, token],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: C.background, borderBottomColor: C.border },
        ]}
      >
        <TouchableOpacity
          onPress={handleBack}
          style={styles.iconBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft color={C.textHeading} size={24} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text
            style={[styles.headerTitle, { color: C.textHeading }]}
            numberOfLines={1}
          >
            All Files
          </Text>
          <Text
            style={[styles.headerSub, { color: C.textBody }]}
            numberOfLines={1}
          >
            {serverTotal} item{serverTotal !== 1 ? "s" : ""} ·{" "}
            {currentSort.label}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.sortBtn, { backgroundColor: C.background }]}
          onPress={() => setShowSortModal(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Sort files"
        >
          <Filter size={15} color={C.primary} />
          <Text style={[styles.sortBtnText, { color: C.primary }]}>Sort</Text>
        </TouchableOpacity>
        {loading && files.length > 0 && (
          <ActivityIndicator
            size="small"
            color={C.primary}
            accessibilityLabel="Refreshing files"
          />
        )}
      </View>

      {/* Search */}
      <View
        style={[
          styles.searchBar,
          { backgroundColor: C.card, borderColor: C.border },
        ]}
      >
        <Search size={18} color={C.textBody} />
        <TextInput
          style={[styles.searchInput, { color: C.textHeading }]}
          placeholder="Search files..."
          placeholderTextColor={C.textBody}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search all files"
        />
        {searchQuery ? (
          <TouchableOpacity
            onPress={() => setSearchQuery("")}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            style={styles.searchClear}
          >
            <X size={18} color={C.textBody} />
          </TouchableOpacity>
        ) : null}
      </View>

      {!searchQuery && (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 12,
            paddingHorizontal: 20,
            marginBottom: 8,
          }}
        >
          <LibraryShortcut
            title="Discover"
            detail="Types, dates & tags"
            icon={SearchCheck}
            tone="violet"
            onPress={() => navigation.navigate("Discover")}
          />
          <LibraryShortcut
            title="Offline"
            detail="Your saved copies"
            icon={CloudDownload}
            tone="mint"
            onPress={() => navigation.navigate("OfflineFiles")}
          />
        </View>
      )}
      {/* List */}

      {loading && files.length === 0 ? (
        <View style={styles.listPad}>
          {[0, 1, 2, 3, 4].map((i) => (
            <FileCardSkeleton key={i} index={i} />
          ))}
        </View>
      ) : loadError && filteredFiles.length === 0 ? (
        <ErrorState
          title="Files unavailable"
          message={loadError}
          onRetry={() => void fetchFiles()}
          style={{ paddingVertical: 80, flex: 0 }}
        />
      ) : filteredFiles.length === 0 ? (
        <EmptyState
          title={searchQuery ? "No results found" : "No files yet"}
          description={
            searchQuery
              ? "Try a different keyword"
              : "Upload files to get started"
          }
          iconType="file"
          style={{ paddingVertical: 80, flex: 0 }}
        />
      ) : (
        <ContentFadeIn visible={true} style={{ flex: 1 }}>
          <FlatList
            data={filteredFiles}
            keyExtractor={(item) => item.id}
            renderItem={renderFile}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={C.primary}
              />
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listPad}
            ListHeaderComponent={
              loadError ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading files"
                  onPress={() => void fetchFiles()}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: C.card,
                    marginBottom: 12,
                  }}
                >
                  <Text
                    style={{ color: C.danger, fontFamily: "Inter_600SemiBold" }}
                  >
                    Could not refresh files · Tap to retry
                  </Text>
                </TouchableOpacity>
              ) : null
            }
            windowSize={5}
            maxToRenderPerBatch={8}
            initialNumToRender={10}
            removeClippedSubviews
            onEndReached={() => void fetchMoreFiles()}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              loadingMore || pageError || loadedFileCount < serverTotal ? (
                <View style={{ paddingVertical: 20, alignItems: "center" }}>
                  {pageError ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Retry loading more files"
                      onPress={() => {
                        setPageError(false);
                        void fetchMoreFiles(true);
                      }}
                    >
                      <Text style={{ color: C.primary, fontWeight: "700" }}>
                        Could not load more · Retry
                      </Text>
                    </TouchableOpacity>
                  ) : loadingMore ? (
                    <ActivityIndicator color={C.primary} />
                  ) : null}
                </View>
              ) : null
            }
          />
        </ContentFadeIn>
      )}

      <FileQuickActions
        item={optionsTarget}
        visible={!!optionsTarget}
        onClose={() => setOptionsTarget(null)}
        onRefresh={fetchFiles}
      />

      {/* Sort Modal */}
      <Modal visible={showSortModal} transparent animationType="slide">
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setShowSortModal(false)}
        >
          <View style={[styles.sheet, { backgroundColor: C.card }]}>
            <View style={[styles.handle, { backgroundColor: C.border }]} />
            <Text style={[styles.sheetTitle, { color: C.textHeading }]}>
              Sort by
            </Text>
            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.sortRow,
                  sortKey === opt.key && { backgroundColor: C.primary + "18" },
                ]}
                onPress={() => {
                  setSortKey(opt.key);
                  setShowSortModal(false);
                }}
                activeOpacity={0.7}
              >
                <opt.icon
                  size={18}
                  color={sortKey === opt.key ? C.primary : C.textBody}
                />
                <Text
                  style={[
                    styles.sortLabel,
                    { color: sortKey === opt.key ? C.primary : C.textHeading },
                    sortKey === opt.key && { fontWeight: "700" as const },
                  ]}
                >
                  {opt.label}
                </Text>
                {sortKey === opt.key && (
                  <View style={[styles.check, { backgroundColor: C.primary }]}>
                    <Text
                      style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}
                    >
                      ✓
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
            <View style={{ height: 28 }} />
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 0,
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 18,
    minHeight: 72,
  },
  iconBtn: {
    justifyContent: "center",
    width: 44,
    height: 44,
    alignItems: "center",

    borderRadius: 22,
    backgroundColor: undefined,
  },
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
    marginTop: 2,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
  },
  sortBtnText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    marginHorizontal: 20,
    marginVertical: 12,
    gap: 10,
    borderWidth: 1,
    height: 56,
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
  listPad: { paddingVertical: 12, paddingHorizontal: 20, paddingBottom: 32 },
  // Sort sheet
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
    fontFamily: "Inter_700Bold",
  },
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  sortLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
});
