import { PlatformAlert as Alert } from "../utils/alert";
import React, {
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  useWindowDimensions,
  FlatList,
  Animated,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Trash2,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Plus,
  Folder,
  MoreHorizontal,
  Star,
  Grid,
  List,
  Info,
  Move,
  Tag,
  CheckSquare,
  Square,
  SortAsc,
  SortDesc,
  Filter,
  X,
  Check,
  Share2,
  ShieldCheck,
  Search,
  Download,
} from "lucide-react-native";
import { Image } from "../components/AppImage";
import { FlashList } from "@shopify/flash-list";
import * as DocumentPicker from "expo-document-picker";
import apiClient from "../services/apiClient";
import { AuthContext } from "../context/AuthContext";
import { useUpload } from "../context/UploadContext";
import { useDownload } from "../context/DownloadContext";
import { useToast } from "../context/ToastContext";

import { useTheme } from "../context/ThemeContext";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { FileCardSkeleton, ContentFadeIn } from "../ui/Skeleton";
import ShareFolderModal from "../components/ShareFolderModal";
import { FileIcon } from "../components/FileIcon";
import { formatFolderMeta } from "../utils/folderMeta";
import { appendUniqueFiles, filePageUrl } from "../utils/filePages";
import { useFileRefresh, useOptimisticFiles } from "../utils/events";
import {
  dedupeFilesById,
  getItemName,
  getItemSize,
  normalizeItems,
  sortItems,
  syncAfterFileMutation,
} from "../services/fileStateSync";
import {
  normalizeUploadFile,
  sanitizeDisplayName,
  sanitizeFileName,
} from "../utils/fileSafety";

const FILTER_TABS = [
  { key: "all", label: "All", Icon: null },
  { key: "image", label: "Images", Icon: ImageIcon },
  { key: "video", label: "Videos", Icon: Video },
  { key: "audio", label: "Audio", Icon: Music },
  { key: "pdf", label: "Docs", Icon: FileText },
  { key: "folder", label: "Folders", Icon: Folder },
];

const SORT_OPTIONS = [
  { key: "created_at_DESC", label: "Newest First" },
  { key: "created_at_ASC", label: "Oldest First" },
  { key: "file_name_ASC", label: "Name A-Z" },
  { key: "file_name_DESC", label: "Name Z-A" },
  { key: "file_size_DESC", label: "Largest First" },
  { key: "file_size_ASC", label: "Smallest First" },
];

const COLORS = [
  "#4B6EF5",
  "#1FD45A",
  "#FCBD0B",
  "#EF4444",
  "#9333EA",
  "#0D9488",
  "#F97316",
  "#EC4899",
];
const PAGE_SIZE = 50;

function formatSize(bytes: number) {
  if (!bytes) return "0 B";
  const k = 1024,
    s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}

const MemoizedFileItem = React.memo(
  ({
    item,
    isSelected,
    isGridView,
    selectMode,
    theme,
    token,
    onAction,
  }: any) => {
    const { width } = useWindowDimensions();
    const gridSize = Math.max(100, (width - 52) / 2);
    const styles = useMemo(
      () => createStyles(theme, gridSize),
      [theme, gridSize],
    );
    const isFolder =
      item.result_type === "folder" || item.mime_type === "inode/directory";
    const scale = useRef(new Animated.Value(1)).current;
    const reducedMotion = useReducedMotion();

    const handlePressIn = () => {
      if (!reducedMotion)
        Animated.spring(scale, {
          toValue: 0.99,
          useNativeDriver: true,
        }).start();
    };
    const handlePressOut = () => {
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
    };

    return (
      <Animated.View
        style={[
          { transform: [{ scale }] },
          isGridView ? { width: gridSize } : {},
        ]}
      >
        <TouchableOpacity
          accessibilityRole={selectMode ? "checkbox" : "button"}
          accessibilityLabel={`${selectMode ? "Select" : "Open"} ${item.name || item.file_name || "File"}`}
          accessibilityState={selectMode ? { checked: isSelected } : undefined}
          aria-checked={selectMode ? isSelected : undefined}
          style={[
            isGridView ? styles.gridCard : styles.fileCard,
            !isGridView && isFolder ? styles.folderRow : null,
            { backgroundColor: theme.colors.card },
            isSelected && styles.fileCardSelected,
            isGridView && { width: "100%" },
          ]}
          activeOpacity={0.8}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={() =>
            onAction(
              selectMode ? "toggle" : isFolder ? "openFolder" : "preview",
              item,
            )
          }
          onLongPress={() => onAction("longPress", item)}
        >
          {isGridView ? (
            <>
              <View
                style={[
                  styles.gridIcon,
                  {
                    backgroundColor: isFolder
                      ? `${theme.colors.primary}15`
                      : theme.colors.surfaceMuted,
                  },
                ]}
              >
                {isFolder ? (
                  <Folder
                    color={theme.colors.primary}
                    size={40}
                    fill={theme.colors.primary}
                  />
                ) : (
                  <FileIcon
                    item={item}
                    size={gridSize * 0.75}
                    token={token}
                    apiBase={apiClient.defaults.baseURL}
                    themeColors={theme.colors}
                    style={{ borderRadius: 0, width: "100%", height: "100%" }}
                  />
                )}
              </View>
              <View style={styles.gridLabel}>
                <Text
                  style={[styles.gridName, { color: theme.colors.textHeading }]}
                  numberOfLines={1}
                >
                  {sanitizeDisplayName(
                    item.name || item.file_name || "File",
                    "File",
                  )}
                </Text>
                <Text
                  style={[styles.gridMeta, { color: theme.colors.textBody }]}
                  numberOfLines={1}
                >
                  {isFolder
                    ? formatFolderMeta(item)
                    : `${formatSize(item.size)} • ${new Date(item.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`.toUpperCase()}
                </Text>
              </View>
              {selectMode && (
                <View style={styles.gridCheckbox}>
                  {isSelected && (
                    <Check color={theme.colors.primary} size={14} />
                  )}
                </View>
              )}
            </>
          ) : (
            <View style={styles.fileCardInner}>
              <FileIcon
                item={item}
                size={42}
                token={token}
                apiBase={apiClient.defaults.baseURL}
                themeColors={theme.colors}
                style={{ marginRight: 16 }}
              />
              <View style={styles.fileDetails}>
                <Text
                  style={[styles.fileName, { color: theme.colors.textHeading }]}
                  numberOfLines={1}
                >
                  {sanitizeDisplayName(
                    item.name || item.file_name || "File",
                    "File",
                  )}
                </Text>
                <Text
                  style={[styles.fileMeta, { color: theme.colors.textBody }]}
                >
                  {isFolder
                    ? formatFolderMeta(item)
                    : `${formatSize(item.size)} • ${new Date(item.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`.toUpperCase()}
                </Text>
              </View>
              {!selectMode && <View style={{ width: 44 }} />}
              {selectMode && (
                <View style={{ paddingRight: 8 }}>
                  {isSelected ? (
                    <CheckSquare color={theme.colors.primary} size={22} />
                  ) : (
                    <Square color={theme.colors.textBody} size={22} />
                  )}
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>
        {!selectMode && !isGridView && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Options for ${item.name || item.file_name || "File"}`}
            style={{
              position: "absolute",
              right: 10,
              top: 22,
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
            onPress={() => onAction("options", item)}
          >
            <MoreHorizontal color={theme.colors.textBody} size={20} />
          </TouchableOpacity>
        )}
      </Animated.View>
    );
  },
  (prev, next) => {
    // Custom comparator to skip massive re-renders
    return (
      prev.item.id === next.item.id &&
      prev.item.updated_at === next.item.updated_at &&
      prev.item.is_starred === next.item.is_starred &&
      prev.item.name === next.item.name &&
      prev.isSelected === next.isSelected &&
      prev.isGridView === next.isGridView &&
      prev.selectMode === next.selectMode &&
      prev.theme === next.theme &&
      prev.token === next.token &&
      prev.onAction === next.onAction &&
      prev.item.file_name === next.item.file_name &&
      prev.item.size === next.item.size &&
      prev.item.content_revision === next.item.content_revision
    );
  },
);

export default function FolderFilesScreen({ route, navigation }: any) {
  const { folderId, folderName, breadcrumb = [] } = route.params;
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gridSize = Math.max(100, (width - 52) / 2);
  const styles = useMemo(
    () => createStyles(theme, gridSize),
    [theme, gridSize],
  );
  const { showToast } = useToast();
  const { token } = useContext(AuthContext);
  const { addDownload } = useDownload();

  // ? Fix #29: debounce markAccessed — max 1 DB write per file per 5 min
  const lastAccessedRef = useRef<Map<string, number>>(new Map());

  // Core data
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const folderRequest = useRef(0);
  const [files, setFiles] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loadedFileCount, setLoadedFileCount] = useState(0);
  const [serverTotal, setServerTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const loadingMoreRef = useRef(false);

  // Client-side pagination — render in batches of PAGE_SIZE
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);

  // View state
  const [filterTab, setFilterTab] = useState("all");
  const [sortKey, setSortKey] = useState("created_at_DESC");
  const [isGridView, setIsGridView] = useState(false);
  const [showSortModal, setShowSortModal] = useState(false);

  // Multi-select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { addUpload } = useUpload();

  // Upload
  const [isUploadSettingsVisible, setUploadSettingsVisible] = useState(false);

  // Modals
  const [isCreateModalVisible, setCreateModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderColor, setFolderColor] = useState(COLORS[0]);
  const [isRenameModalVisible, setRenameModalVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<any>(null);
  const [renameValue, setRenameValue] = useState("");

  // File Info Sheet
  const [infoFile, setInfoFile] = useState<any>(null);
  const [infoTags, setInfoTags] = useState<string[]>([]);
  const [infoLoading, setInfoLoading] = useState(false);
  const infoRequest = useRef(0);
  const [newTagInput, setNewTagInput] = useState("");

  // Share Modal
  const [isShareModalVisible, setShareModalVisible] = useState(false);
  const [shareTarget, setShareTarget] = useState<any>(null);
  const closeShareModal = () => {
    setShareModalVisible(false);
    setTimeout(() => setShareTarget(null), 220);
  };

  // Move modal
  const [isMoveModalVisible, setMoveModalVisible] = useState(false);
  const [allFolders, setAllFolders] = useState<any[]>([]);
  const [moveTarget, setMoveTarget] = useState<any>(null);

  // Options Modal
  const [optionsTarget, setOptionsTarget] = useState<any>(null);

  useEffect(() => {
    setFiles([]);
    setLoadError("");
  }, [folderId]);

  useEffect(() => {
    const timeout = setTimeout(
      () => setDebouncedQuery(searchQuery.trim()),
      250,
    );
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    fetchFolderFiles();
  }, [folderId, sortKey, filterTab, debouncedQuery]);

  useFileRefresh(() => {
    fetchFolderFiles();
  });
  useOptimisticFiles(setFiles, (item) => {
    const isFolder =
      item.mime_type === "inode/directory" || item.result_type === "folder";
    const inFolder = isFolder
      ? String(item.parent_id) === String(folderId)
      : String(item.folder_id) === String(folderId);
    const matchesName =
      !debouncedQuery ||
      String(item.name || item.file_name || "")
        .toLowerCase()
        .includes(debouncedQuery.toLowerCase());
    const mime = String(item.mime_type || "");
    const matchesType =
      filterTab === "all" ||
      (filterTab === "folder" && isFolder) ||
      (filterTab === "pdf" &&
        !isFolder &&
        !mime.startsWith("image/") &&
        !mime.startsWith("video/") &&
        !mime.startsWith("audio/")) ||
      (!isFolder && mime.includes(filterTab));
    return inFolder && matchesName && matchesType;
  });

  // Reset display limit when filter/search changes
  useEffect(() => {
    setDisplayLimit(PAGE_SIZE);
  }, [filterTab, searchQuery]);

  const fetchFolderFiles = async () => {
    const requestVersion = ++folderRequest.current;
    setIsLoading(true);
    setLoadError("");
    setPageError(false);
    setLoadedFileCount(0);
    setServerTotal(0);
    setDisplayLimit(PAGE_SIZE);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    try {
      const [filesRes, foldersRes] = await Promise.all([
        filterTab === "folder"
          ? Promise.resolve({
              data: { success: true, files: [], total_count: 0 },
            })
          : apiClient.get(
              filePageUrl({
                folderId,
                sortKey,
                query: debouncedQuery,
                type: filterTab === "pdf" ? "docs" : filterTab,
                offset: 0,
              }),
            ),
        apiClient.get(
          `/files/folders?parent_id=${encodeURIComponent(folderId)}`,
        ),
      ]);
      if (!filesRes.data.success || !foldersRes.data.success)
        throw new Error("Folder request failed");
      let merged: any[] = [];
      if (foldersRes.data.success) {
        merged = foldersRes.data.folders.map((f: any) => ({
          ...f,
          name: f.name,
          mime_type: "inode/directory",
          result_type: "folder",
        }));
      }
      const firstPage = filesRes.data.files || [];
      merged = [...merged, ...firstPage];

      const normalized = normalizeItems(merged, sortKey as any);
      if (requestVersion === folderRequest.current) {
        setFiles(normalized);
        setLoadedFileCount(firstPage.length);
        setServerTotal(Number(filesRes.data.total_count) || 0);
      }
    } catch (e) {
      if (requestVersion !== folderRequest.current) return;
      setLoadError("Could not load folder contents.");
      showToast("Could not load folder contents", "error");
    } finally {
      if (requestVersion === folderRequest.current) setIsLoading(false);
    }
  };

  const fetchMoreFolderFiles = async (retry = false) => {
    if (
      isLoading ||
      loadingMoreRef.current ||
      (pageError && !retry) ||
      loadedFileCount >= serverTotal ||
      filterTab === "folder"
    )
      return;
    const requestVersion = folderRequest.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const response = await apiClient.get(
        filePageUrl({
          folderId,
          sortKey,
          query: debouncedQuery,
          type: filterTab === "pdf" ? "docs" : filterTab,
          offset: loadedFileCount,
        }),
      );
      if (!response.data.success) throw new Error("Could not load more files");
      if (requestVersion !== folderRequest.current) return;
      const page = response.data.files || [];
      setFiles((current) =>
        normalizeItems(appendUniqueFiles(current, page), sortKey as any),
      );
      setLoadedFileCount((count) => count + page.length);
      setServerTotal(Number(response.data.total_count) || 0);
      if (page.length === 0 && loadedFileCount < serverTotal)
        setPageError(true);
    } catch {
      if (requestVersion === folderRequest.current) setPageError(true);
    } finally {
      if (requestVersion === folderRequest.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  };

  const filteredFiles = files.filter((item) => {
    const matchesTab =
      filterTab === "all" ||
      (filterTab === "folder" &&
        (item.result_type === "folder" ||
          item.mime_type === "inode/directory")) ||
      (filterTab === "pdf"
        ? !item.mime_type?.startsWith("image/") &&
          !item.mime_type?.startsWith("video/") &&
          !item.mime_type?.startsWith("audio/") &&
          item.mime_type !== "inode/directory"
        : item.mime_type?.includes(filterTab));
    const matchesSearch =
      !debouncedQuery ||
      (item.name || item.file_name || "")
        .toLowerCase()
        .includes(debouncedQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkAction = async (
    action: "trash" | "star" | "move" | "download",
  ) => {
    const ids = Array.from(selectedIds).filter((id) => {
      const item = files.find((f) => f.id === id);
      return item && item.result_type !== "folder";
    });
    if (ids.length === 0) {
      setSelectMode(false);
      setSelectedIds(new Set());
      return;
    }

    if (action === "download") {
      if (!token) {
        showToast("Sign in again to download files", "error");
        return;
      }
      if (ids.length > 20) {
        showToast("Select up to 20 files per download batch", "error");
        return;
      }
      for (const id of ids) {
        const item = files.find((file) => file.id === id);
        if (item) addDownload(id, getItemName(item), token, item.mime_type);
      }
      showToast(`${ids.length} download${ids.length === 1 ? "" : "s"} queued`);
      setSelectMode(false);
      setSelectedIds(new Set());
      return;
    }

    try {
      if (action === "trash") {
        await apiClient.post("/files/bulk", { ids, action: "trash" });
        fetchFolderFiles();
        syncAfterFileMutation();
      } else if (action === "star") {
        await apiClient.post("/files/bulk", { ids, action: "star" });
        fetchFolderFiles();
        syncAfterFileMutation({ clearCache: true });
      } else if (action === "move") {
        // Fetch all root-level folders so the Move modal is populated
        try {
          const fRes = await apiClient.get("/files/folders");
          if (fRes.data.success) setAllFolders(fRes.data.folders || []);
        } catch {
          /* non-critical — modal still opens with empty list */
        }
        setMoveTarget({ ids });
        setMoveModalVisible(true);
        return; // don't reset select mode yet
      }
    } catch (e) {
      showToast("Bulk action failed", "error");
    } finally {
      setSelectMode(false);
      setSelectedIds(new Set());
    }
  };

  const handleBulkMove = async (targetFolderId: string | null) => {
    if (!moveTarget?.ids) return;
    try {
      await apiClient.post("/files/bulk", {
        ids: moveTarget.ids,
        action: "move",
        folder_id: targetFolderId,
      });
      setMoveModalVisible(false);
      setMoveTarget(null);
      setSelectMode(false);
      setSelectedIds(new Set());
      fetchFolderFiles();
      syncAfterFileMutation();
    } catch (e) {
      showToast("Could not move files", "error");
    }
  };

  const handleDelete = async (item: any) => {
    const isFolder =
      item.result_type === "folder" || item.mime_type === "inode/directory";
    const name = item.name || item.file_name;
    Alert.alert(
      isFolder ? "Move Folder to Trash" : "Move to Trash",
      isFolder
        ? `Move "${name}" and all its contents to trash?`
        : `Move "${name}" to trash?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move to Trash",
          style: "destructive",
          onPress: async () => {
            try {
              if (isFolder) {
                await apiClient.delete(`/files/folder/${item.id}`);
              } else {
                await apiClient.patch(`/files/${item.id}/trash`);
              }
              fetchFolderFiles();
              syncAfterFileMutation();
            } catch (e: any) {
              showToast(
                e.response?.data?.error || "Could not move to trash",
                "error",
              );
            }
          },
        },
      ],
    );
  };

  // -- Delete current folder --------------------------------------------
  const handleDeleteCurrentFolder = () => {
    Alert.alert(
      "Move Folder to Trash",
      `Move "${folderName}" and all its contents to trash?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move to Trash",
          style: "destructive",
          onPress: async () => {
            try {
              await apiClient.delete(`/files/folder/${folderId}`);
              syncAfterFileMutation();
              navigation.goBack();
            } catch (e: any) {
              showToast(
                e.response?.data?.error || "Could not delete folder",
                "error",
              );
            }
          },
        },
      ],
    );
  };

  const handleLoadMore = useCallback(() => {
    if (filteredFiles.length > displayLimit)
      setDisplayLimit((prev) => prev + PAGE_SIZE);
    else void fetchMoreFolderFiles();
  }, [filteredFiles.length, displayLimit, fetchMoreFolderFiles]);

  const handleCreateFolder = async () => {
    const nextFolderName = sanitizeFileName(newFolderName, "New Folder");
    if (!nextFolderName) return;
    try {
      await apiClient.post("/files/folder", {
        name: nextFolderName,
        parent_id: folderId,
        color: folderColor,
      });
      setNewFolderName("");
      setCreateModalVisible(false);
      fetchFolderFiles();
      syncAfterFileMutation();
    } catch (e: any) {
      showToast(e.response?.data?.error || "Failed", "error");
    }
  };

  const handleRename = async () => {
    const nextName = sanitizeFileName(renameValue, "file");
    if (!nextName || !renameTarget) return;
    try {
      const endpoint =
        renameTarget.result_type === "folder"
          ? `/files/folder/${renameTarget.id}`
          : `/files/${renameTarget.id}`;
      await apiClient.patch(endpoint, { name: nextName, file_name: nextName });
      setRenameTarget(null);
      setRenameModalVisible(false);
      fetchFolderFiles();
      syncAfterFileMutation();
    } catch (e: any) {
      showToast(e.response?.data?.error || "Failed", "error");
    }
  };

  const openInfoSheet = async (item: any) => {
    const requestVersion = ++infoRequest.current;
    setInfoFile(item);
    setInfoTags([]);
    setNewTagInput("");
    setInfoLoading(false);
    const isFolder =
      item.result_type === "folder" || item.mime_type === "inode/directory";
    if (isFolder) return;
    setInfoLoading(true);
    try {
      const tagsRes = await apiClient.get(`/files/${item.id}/tags`);
      if (requestVersion === infoRequest.current)
        setInfoTags(tagsRes.data.tags || []);
    } catch {
      if (requestVersion === infoRequest.current)
        showToast("Could not load tags", "error");
    } finally {
      if (requestVersion === infoRequest.current) setInfoLoading(false);
    }
  };

  const closeInfoSheet = () => {
    ++infoRequest.current;
    setInfoFile(null);
    setInfoTags([]);
    setInfoLoading(false);
    setNewTagInput("");
  };

  const addTagToFile = async () => {
    if (!newTagInput.trim() || !infoFile) return;
    try {
      await apiClient.post(`/files/${infoFile.id}/tags`, {
        tag: newTagInput.trim(),
      });
      setNewTagInput("");
      const res = await apiClient.get(`/files/${infoFile.id}/tags`);
      setInfoTags(res.data.tags || []);
    } catch {
      showToast("Could not add tag", "error");
    }
  };

  const removeTagFromFile = async (tag: string) => {
    if (!infoFile) return;
    try {
      await apiClient.delete(
        `/files/${infoFile.id}/tags/${encodeURIComponent(tag)}`,
      );
      const res = await apiClient.get(`/files/${infoFile.id}/tags`);
      setInfoTags(res.data.tags || []);
    } catch {
      showToast("Could not remove tag", "error");
    }
  };

  const handleUploadInit = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const fileAssets = res.assets.map((a) => {
        const normalized = normalizeUploadFile({
          uri: a.uri,
          name: a.name,
          mimeType: a.mimeType,
        });

        return {
          uri: normalized.uri,
          name: normalized.name,
          size: a.size ?? 0,
          mimeType: normalized.type,
        };
      });
      addUpload(fileAssets, folderId, "me");
    } catch {
      showToast("Pick failed", "error");
    }
  };

  const currentBreadcrumb = [...breadcrumb, { id: folderId, name: folderName }];

  const handleCardAction = useCallback(
    (action: string, item: any) => {
      if (action === "options") {
        setOptionsTarget(item);
      } else if (action === "toggle" || action === "longPress") {
        if (action === "longPress" && !selectMode) setSelectMode(true);
        toggleSelect(item.id);
      } else if (action === "openFolder") {
        navigation.push("FolderFiles", {
          folderId: item.id,
          folderName: item.name,
          breadcrumb: currentBreadcrumb,
        });
      } else if (action === "preview") {
        const now = Date.now();
        const last = lastAccessedRef.current.get(item.id) ?? 0;
        if (now - last > 5 * 60 * 1000) {
          lastAccessedRef.current.set(item.id, now);
          apiClient.post(`/files/${item.id}/accessed`).catch(() => {});
        }
        const previewableFiles = filteredFiles.filter(
          (f) => f.mime_type !== "inode/directory",
        );
        const idx = previewableFiles.findIndex((f) => f.id === item.id);
        navigation.navigate("FilePreview", {
          files: previewableFiles,
          initialIndex: idx === -1 ? 0 : idx,
        });
      } else if (action === "rename") {
        setRenameTarget(item);
        setRenameValue(item.name || item.file_name);
        setRenameModalVisible(true);
      } else if (action === "info") {
        openInfoSheet(item);
      } else if (action === "shareLink") {
        setShareTarget(item);
        setShareModalVisible(true);
      } else if (action === "star") {
        apiClient
          .patch(`/files/${item.id}/star`)
          .then(() => {
            fetchFolderFiles();
            syncAfterFileMutation({ clearCache: true });
          })
          .catch(() => showToast("Could not update star", "error"));
      } else if (action === "move") {
        apiClient
          .get("/files/folders")
          .then((res: any) => {
            if (res.data.success) {
              setAllFolders(res.data.folders);
              setMoveTarget({ ids: [item.id] });
              setMoveModalVisible(true);
            }
          })
          .catch(() => showToast("Could not load folders", "error"));
      } else if (action === "trash") {
        handleDelete(item);
      }
    },
    [
      selectMode,
      navigation,
      toggleSelect,
      currentBreadcrumb,
      filteredFiles,
      fetchFolderFiles,
    ],
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.background, paddingTop: insets.top },
      ]}
    >
      <View
        style={[styles.header, { backgroundColor: theme.colors.background }]}
      >
        <TouchableOpacity
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={selectMode ? "Cancel selection" : "Back"}
          onPress={() => {
            if (selectMode) {
              setSelectMode(false);
              setSelectedIds(new Set());
            } else navigation.goBack();
          }}
        >
          {selectMode ? (
            <X color={theme.colors.textHeading} size={22} />
          ) : (
            <ArrowLeft color={theme.colors.textHeading} size={24} />
          )}
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text
            style={[styles.headerTitle, { color: theme.colors.textHeading }]}
            numberOfLines={1}
          >
            {selectMode ? `${selectedIds.size} selected` : folderName}
          </Text>
        </View>

        <View style={styles.headerActions}>
          {!selectMode && (
            <>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => setIsGridView((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={
                  isGridView ? "Use list view" : "Use grid view"
                }
              >
                {isGridView ? (
                  <List color={theme.colors.textHeading} size={20} />
                ) : (
                  <Grid color={theme.colors.textHeading} size={20} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => setShowSortModal(true)}
                accessibilityRole="button"
                accessibilityLabel="Sort files"
              >
                <SortAsc color={theme.colors.textHeading} size={20} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => setCreateModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Create subfolder"
              >
                <Plus color={theme.colors.textHeading} size={22} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={handleDeleteCurrentFolder}
                accessibilityRole="button"
                accessibilityLabel="Move current folder to trash"
              >
                <Trash2 color={theme.colors.danger} size={20} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {breadcrumb.length > 0 && (
        <View
          style={[
            styles.breadcrumbBar,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderBottomColor: theme.colors.border,
            },
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              alignItems: "center",
              paddingHorizontal: 20,
            }}
          >
            <TouchableOpacity
              onPress={() =>
                navigation.navigate("MainTabs", { screen: "Home" })
              }
            >
              <Text style={[styles.crumbLink, { color: theme.colors.primary }]}>
                Home
              </Text>
            </TouchableOpacity>
            {breadcrumb.map((b, i) => (
              <React.Fragment key={b.id}>
                <Text
                  style={[styles.crumbSep, { color: theme.colors.textBody }]}
                >
                  {" "}
                  ›{" "}
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    navigation.push("FolderFiles", {
                      folderId: b.id,
                      folderName: b.name,
                      breadcrumb: breadcrumb.slice(0, i),
                    })
                  }
                >
                  <Text
                    style={[styles.crumbLink, { color: theme.colors.primary }]}
                  >
                    {b.name}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </ScrollView>
        </View>
      )}

      <View
        style={{ backgroundColor: theme.colors.background, paddingBottom: 10 }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabBar}
          contentContainerStyle={{
            gap: 8,
            paddingHorizontal: 20,
            alignItems: "center",
          }}
        >
          {FILTER_TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              accessibilityRole="button"
              accessibilityLabel={`Show ${t.label.toLowerCase()}`}
              accessibilityState={{ selected: filterTab === t.key }}
              aria-selected={filterTab === t.key}
              style={[
                styles.tab,
                {
                  backgroundColor:
                    filterTab === t.key
                      ? theme.colors.primary
                      : theme.colors.background,
                },
                filterTab === t.key && styles.tabActive,
              ]}
              onPress={() => setFilterTab(t.key)}
            >
              <View style={styles.tabInner}>
                {t.Icon ? (
                  <t.Icon
                    color={filterTab === t.key ? "#fff" : theme.colors.textBody}
                    size={14}
                  />
                ) : null}
                <Text
                  style={[
                    styles.tabText,
                    {
                      color:
                        filterTab === t.key ? "#fff" : theme.colors.textBody,
                    },
                    filterTab === t.key && styles.tabTextActive,
                  ]}
                >
                  {t.label}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={{ paddingHorizontal: 20 }}>
          <View
            style={[
              styles.searchContainer,
              {
                backgroundColor: theme.colors.background,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Search color={theme.colors.textBody} size={18} />
            <TextInput
              style={[styles.searchInput, { color: theme.colors.textHeading }]}
              placeholder={`Search in ${folderName}...`}
              placeholderTextColor={theme.colors.textBody}
              value={searchQuery}
              onChangeText={setSearchQuery}
              accessibilityLabel={`Search in ${folderName}`}
            />
            {searchQuery ? (
              <TouchableOpacity
                onPress={() => setSearchQuery("")}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                style={{
                  width: 44,
                  height: 44,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <X color={theme.colors.textBody} size={18} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      {/* ? FlatList with client-side pagination — loads PAGE_SIZE at a time */}
      <ContentFadeIn visible={true} style={{ flex: 1 }}>
        <FlatList
          style={styles.scrollArea}
          data={filteredFiles.slice(0, displayLimit)}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <MemoizedFileItem
              item={item}
              isSelected={selectedIds.has(item.id)}
              isGridView={isGridView}
              selectMode={selectMode}
              theme={theme}
              token={token}
              onAction={handleCardAction}
            />
          )}
          numColumns={isGridView ? 2 : 1}
          key={isGridView ? "grid" : "list"}
          columnWrapperStyle={isGridView ? styles.gridContainer : undefined}
          contentContainerStyle={{
            paddingBottom: 100,
            paddingTop: isGridView ? 12 : 8,
          }}
          showsVerticalScrollIndicator={false}
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            !isLoading &&
            (filteredFiles.length > displayLimit ||
              loadedFileCount < serverTotal ||
              loadingMore ||
              pageError) ? (
              <View style={{ paddingVertical: 20, alignItems: "center" }}>
                {pageError ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading more files"
                    onPress={() => {
                      setPageError(false);
                      void fetchMoreFolderFiles(true);
                    }}
                  >
                    <Text
                      style={{ color: theme.colors.primary, fontWeight: "700" }}
                    >
                      Could not load more · Retry
                    </Text>
                  </TouchableOpacity>
                ) : loadingMore ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.primary}
                  />
                ) : null}
                <Text
                  style={{
                    fontSize: 12,
                    color: theme.colors.textBody,
                    marginTop: 8,
                  }}
                >
                  Showing {Math.min(displayLimit, filteredFiles.length)} of{" "}
                  {Math.max(
                    filteredFiles.length,
                    serverTotal +
                      files.filter((item) => item.result_type === "folder")
                        .length,
                  )}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            isLoading ? (
              <View style={{ paddingTop: 12 }}>
                {[1, 2, 3, 4].map((i) => (
                  <FileCardSkeleton key={i} />
                ))}
              </View>
            ) : loadError ? (
              <ErrorState
                title="Could not load folder"
                message={loadError}
                onRetry={() => void fetchFolderFiles()}
                style={{ paddingVertical: 60, flex: 0 }}
              />
            ) : (
              <EmptyState
                title={
                  searchQuery || filterTab !== "all"
                    ? "No matching files"
                    : "Folder is empty"
                }
                description={
                  searchQuery || filterTab !== "all"
                    ? "Try another filter or search term"
                    : "Upload files or create subfolders here"
                }
                iconType={
                  searchQuery || filterTab !== "all" ? "search" : "folder"
                }
                buttonText={
                  searchQuery || filterTab !== "all"
                    ? "Show all files"
                    : undefined
                }
                onButtonPress={() => {
                  setSearchQuery("");
                  setFilterTab("all");
                }}
                style={{ paddingVertical: 60, flex: 0 }}
              />
            )
          }
        />
      </ContentFadeIn>

      {selectMode && (
        <View
          style={[
            styles.bulkBar,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              bottom: Math.max(insets.bottom, 12) + 12,
            },
          ]}
        >
          {(
            [
              ["Download", Download, "download", theme.colors.primary],
              ["Star", Star, "star", theme.colors.accent],
              ["Move", Move, "move", theme.colors.primary],
              ["Trash", Trash2, "trash", theme.colors.danger],
            ] as const
          ).map(([label, Icon, action, color]) => (
            <TouchableOpacity
              key={action}
              accessibilityRole="button"
              accessibilityLabel={`${label} selected files`}
              accessibilityState={{ disabled: selectedIds.size === 0 }}
              disabled={selectedIds.size === 0}
              style={styles.bulkAction}
              onPress={() => void handleBulkAction(action)}
            >
              <Icon
                color={selectedIds.size === 0 ? theme.colors.textBody : color}
                size={20}
              />
              <Text
                style={[
                  styles.bulkActionLabel,
                  {
                    color:
                      selectedIds.size === 0
                        ? theme.colors.textBody
                        : theme.colors.textHeading,
                  },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!selectMode && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: theme.colors.primary }]}
          onPress={handleUploadInit}
        >
          <Plus color="#fff" size={32} />
        </TouchableOpacity>
      )}

      <Modal visible={isCreateModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.centeredModal}
        >
          <View
            style={[styles.modalCard, { backgroundColor: theme.colors.card }]}
          >
            <Text
              style={[styles.modalTitle, { color: theme.colors.textHeading }]}
            >
              New Folder
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  borderColor: theme.colors.border,
                  color: theme.colors.textHeading,
                  backgroundColor: theme.colors.background,
                },
              ]}
              placeholder="Folder name"
              placeholderTextColor={theme.colors.textBody}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: theme.colors.background },
                ]}
                onPress={() => setCreateModalVisible(false)}
              >
                <Text
                  style={[
                    styles.modalBtnText,
                    { color: theme.colors.textHeading },
                  ]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: theme.colors.primary },
                ]}
                onPress={handleCreateFolder}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>
                  Create
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* -- Move Files Modal -------------------------------------- */}
      <Modal visible={isMoveModalVisible} transparent animationType="slide">
        <TouchableOpacity
          style={[
            styles.centeredModal,
            { justifyContent: "flex-end", padding: 0 },
          ]}
          activeOpacity={1}
          onPress={() => {
            setMoveModalVisible(false);
            setMoveTarget(null);
            setSelectMode(false);
            setSelectedIds(new Set());
          }}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.colors.card,
                borderRadius: 0,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingBottom: 40,
              },
            ]}
          >
            <View
              style={{
                width: 40,
                height: 4,
                backgroundColor: theme.colors.border,
                borderRadius: 2,
                alignSelf: "center",
                marginBottom: 20,
              }}
            />
            <Text
              style={[
                styles.modalTitle,
                { color: theme.colors.textHeading, marginBottom: 4 },
              ]}
            >
              Move {moveTarget?.ids?.length || 0} file(s) to...
            </Text>
            <Text
              style={[
                styles.modalSub,
                { color: theme.colors.textBody, marginBottom: 20 },
              ]}
            >
              Choose a destination folder
            </Text>

            {/* Root option */}
            <TouchableOpacity
              style={[
                styles.modalBtn,
                {
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 10,
                  paddingHorizontal: 16,
                  width: "100%",
                  backgroundColor: theme.colors.background,
                },
              ]}
              onPress={() => handleBulkMove(null)}
            >
              <Folder color={theme.colors.primary} size={20} />
              <Text
                style={[
                  styles.modalBtnText,
                  { color: theme.colors.textHeading },
                ]}
              >
                Home (Root)
              </Text>
            </TouchableOpacity>

            {allFolders
              .filter((f) => f.id !== folderId)
              .map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    styles.modalBtn,
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 10,
                      paddingHorizontal: 16,
                      width: "100%",
                      backgroundColor: theme.colors.background,
                    },
                  ]}
                  onPress={() => handleBulkMove(f.id)}
                >
                  <Folder color={theme.colors.accent} size={20} />
                  <Text
                    style={[
                      styles.modalBtnText,
                      { color: theme.colors.textHeading },
                    ]}
                  >
                    {f.name}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* -- Rename Modal -------------------------------------- */}
      <Modal visible={isRenameModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.centeredModal}
        >
          <View
            style={[styles.modalCard, { backgroundColor: theme.colors.card }]}
          >
            <Text
              style={[styles.modalTitle, { color: theme.colors.textHeading }]}
            >
              Rename
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  borderColor: theme.colors.border,
                  color: theme.colors.textHeading,
                  backgroundColor: theme.colors.background,
                },
              ]}
              placeholder="New name"
              placeholderTextColor={theme.colors.textBody}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              onSubmitEditing={handleRename}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: theme.colors.background },
                ]}
                onPress={() => {
                  setRenameModalVisible(false);
                  setRenameTarget(null);
                }}
              >
                <Text
                  style={[
                    styles.modalBtnText,
                    { color: theme.colors.textHeading },
                  ]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: theme.colors.primary },
                ]}
                onPress={handleRename}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>
                  Rename
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* -- Sort Modal --------------------------------------- */}
      <Modal visible={showSortModal} transparent animationType="slide">
        <TouchableOpacity
          style={[
            styles.centeredModal,
            { justifyContent: "flex-end", padding: 0 },
          ]}
          activeOpacity={1}
          onPress={() => setShowSortModal(false)}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.colors.card,
                borderRadius: 0,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingBottom: 40,
              },
            ]}
          >
            <View
              style={{
                width: 36,
                height: 4,
                backgroundColor: theme.colors.border,
                borderRadius: 2,
                alignSelf: "center",
                marginBottom: 16,
              }}
            />
            <Text
              style={[
                styles.modalTitle,
                { color: theme.colors.textHeading, marginBottom: 12 },
              ]}
            >
              Sort by
            </Text>
            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 14,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  marginBottom: 4,
                  backgroundColor:
                    sortKey === opt.key
                      ? theme.colors.primary + "18"
                      : "transparent",
                }}
                onPress={() => {
                  setSortKey(opt.key);
                  setShowSortModal(false);
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: 15,
                    color:
                      sortKey === opt.key
                        ? theme.colors.primary
                        : theme.colors.textHeading,
                    fontWeight: sortKey === opt.key ? "700" : "400",
                  }}
                >
                  {opt.label}
                </Text>
                {sortKey === opt.key && (
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: theme.colors.primary,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}
                    >
                      ✓
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* -- Options Modal --------------------------------------- */}
      <Modal visible={!!optionsTarget} transparent animationType="slide">
        <TouchableOpacity
          style={[
            styles.centeredModal,
            { justifyContent: "flex-end", padding: 0 },
          ]}
          activeOpacity={1}
          onPress={() => setOptionsTarget(null)}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.colors.card,
                borderRadius: 0,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingBottom: 40,
                paddingTop: 16,
              },
            ]}
          >
            <View
              style={{
                width: 40,
                height: 5,
                backgroundColor: theme.colors.border,
                borderRadius: 3,
                alignSelf: "center",
                marginBottom: 20,
              }}
            />
            <Text
              style={[
                styles.modalTitle,
                {
                  color: theme.colors.textHeading,
                  marginBottom: 16,
                  fontSize: 18,
                },
              ]}
            >
              {optionsTarget?.name || optionsTarget?.file_name}
            </Text>

            <TouchableOpacity
              style={styles.optionItem}
              onPress={() => {
                setOptionsTarget(null);
                handleCardAction("shareLink", optionsTarget);
              }}
            >
              <Share2 color={theme.colors.primary} size={20} />
              <Text
                style={[styles.optionText, { color: theme.colors.textHeading }]}
              >
                Share Link
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.optionItem}
              onPress={() => {
                setOptionsTarget(null);
                handleCardAction("rename", optionsTarget);
              }}
            >
              <Tag color={theme.colors.textHeading} size={20} />
              <Text
                style={[styles.optionText, { color: theme.colors.textHeading }]}
              >
                Rename
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.optionItem}
              onPress={() => {
                setOptionsTarget(null);
                handleCardAction("info", optionsTarget);
              }}
            >
              <Info color={theme.colors.textHeading} size={20} />
              <Text
                style={[styles.optionText, { color: theme.colors.textHeading }]}
              >
                Info & Tags
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.optionItem}
              onPress={() => {
                setOptionsTarget(null);
                handleCardAction("star", optionsTarget);
              }}
            >
              <Star
                color={
                  optionsTarget?.is_starred
                    ? "#F59E0B"
                    : theme.colors.textHeading
                }
                size={20}
                fill={optionsTarget?.is_starred ? "#F59E0B" : "transparent"}
              />
              <Text
                style={[styles.optionText, { color: theme.colors.textHeading }]}
              >
                {optionsTarget?.is_starred ? "Unstar" : "Star"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.optionItem}
              onPress={() => {
                setOptionsTarget(null);
                handleCardAction("move", optionsTarget);
              }}
            >
              <Move color={theme.colors.textHeading} size={20} />
              <Text
                style={[styles.optionText, { color: theme.colors.textHeading }]}
              >
                Move to Folder
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.optionItem,
                { backgroundColor: theme.colors.dangerSoft, marginTop: 8 },
              ]}
              onPress={() => {
                setOptionsTarget(null);
                handleCardAction("trash", optionsTarget);
              }}
            >
              <Trash2 color="#EF4444" size={20} />
              <Text style={[styles.optionText, { color: "#EF4444" }]}>
                Move to Trash
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* File details are read-only until a deliberate tag or share action. */}
      <Modal
        visible={!!infoFile}
        transparent
        animationType="slide"
        onRequestClose={closeInfoSheet}
      >
        <View
          style={[
            styles.centeredModal,
            { justifyContent: "flex-end", padding: 0 },
          ]}
        >
          <TouchableOpacity
            accessibilityLabel="Close file details"
            style={StyleSheet.absoluteFill}
            onPress={closeInfoSheet}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%", maxWidth: 520, maxHeight: "88%" }}
          >
            <View
              style={{
                backgroundColor: theme.colors.card,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingHorizontal: 22,
                paddingTop: 16,
                paddingBottom: Math.max(insets.bottom, 20),
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.colors.border,
                  alignSelf: "center",
                  marginBottom: 20,
                }}
              />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 18,
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 13,
                    backgroundColor: theme.colors.inputBg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {infoFile?.result_type === "folder" ||
                  infoFile?.mime_type === "inode/directory" ? (
                    <Folder size={22} color={theme.colors.primary} />
                  ) : (
                    <FileText size={22} color={theme.colors.primary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: theme.colors.textHeading,
                      fontSize: 18,
                      fontWeight: "700",
                    }}
                    numberOfLines={2}
                  >
                    {getItemName(infoFile)}
                  </Text>
                  <Text style={{ color: theme.colors.textBody, marginTop: 3 }}>
                    Details
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close details"
                  onPress={closeInfoSheet}
                  style={styles.iconBtn}
                >
                  <X size={20} color={theme.colors.textHeading} />
                </TouchableOpacity>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 8 }}
              >
                {[
                  [
                    "Type",
                    infoFile?.result_type === "folder" ||
                    infoFile?.mime_type === "inode/directory"
                      ? "Folder"
                      : String(infoFile?.mime_type || "File"),
                  ],
                  [
                    "Size",
                    infoFile?.result_type === "folder" ||
                    infoFile?.mime_type === "inode/directory"
                      ? formatFolderMeta(infoFile || {})
                      : formatSize(getItemSize(infoFile)),
                  ],
                  ["Location", folderName],
                  [
                    "Added",
                    infoFile?.created_at
                      ? new Date(infoFile.created_at).toLocaleDateString()
                      : "—",
                  ],
                ].map(([label, value]) => (
                  <View
                    key={label}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 18,
                      paddingVertical: 11,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    <Text
                      style={{ color: theme.colors.textBody, fontSize: 13 }}
                    >
                      {label}
                    </Text>
                    <Text
                      selectable
                      style={{
                        color: theme.colors.textHeading,
                        fontSize: 13,
                        fontWeight: "600",
                        flex: 1,
                        textAlign: "right",
                      }}
                    >
                      {value}
                    </Text>
                  </View>
                ))}
                {infoFile?.result_type !== "folder" &&
                  infoFile?.mime_type !== "inode/directory" && (
                    <>
                      <Text
                        style={{
                          color: theme.colors.textHeading,
                          fontSize: 15,
                          fontWeight: "700",
                          marginTop: 24,
                          marginBottom: 12,
                        }}
                      >
                        Tags
                      </Text>
                      {infoLoading ? (
                        <ActivityIndicator color={theme.colors.primary} />
                      ) : (
                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: 8,
                          }}
                        >
                          {infoTags.length === 0 && (
                            <Text
                              style={{
                                color: theme.colors.textBody,
                                fontSize: 13,
                              }}
                            >
                              No tags yet
                            </Text>
                          )}
                          {infoTags.map((tag) => (
                            <TouchableOpacity
                              key={tag}
                              accessibilityRole="button"
                              accessibilityLabel={`Remove tag ${tag}`}
                              onPress={() => void removeTagFromFile(tag)}
                              style={{
                                flexDirection: "row",
                                gap: 6,
                                alignItems: "center",
                                paddingHorizontal: 12,
                                paddingVertical: 8,
                                borderRadius: 20,
                                backgroundColor: theme.colors.inputBg,
                              }}
                            >
                              <Text
                                style={{
                                  color: theme.colors.textHeading,
                                  fontSize: 13,
                                }}
                              >
                                {tag}
                              </Text>
                              <X size={13} color={theme.colors.textBody} />
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 8,
                          marginTop: 16,
                          alignItems: "center",
                        }}
                      >
                        <TextInput
                          accessibilityLabel="New file tag"
                          placeholder="Add a tag"
                          placeholderTextColor={theme.colors.textBody}
                          value={newTagInput}
                          onChangeText={setNewTagInput}
                          onSubmitEditing={() => void addTagToFile()}
                          style={{
                            flex: 1,
                            color: theme.colors.textHeading,
                            backgroundColor: theme.colors.inputBg,
                            borderRadius: 12,
                            paddingHorizontal: 14,
                            minHeight: 44,
                          }}
                        />
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel="Add tag"
                          disabled={!newTagInput.trim()}
                          onPress={() => void addTagToFile()}
                          style={{
                            minWidth: 56,
                            minHeight: 44,
                            borderRadius: 12,
                            backgroundColor: theme.colors.primary,
                            justifyContent: "center",
                            alignItems: "center",
                            opacity: newTagInput.trim() ? 1 : 0.5,
                          }}
                        >
                          <Plus size={20} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
              </ScrollView>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open share settings"
                onPress={() => {
                  const target = infoFile;
                  closeInfoSheet();
                  setTimeout(() => {
                    setShareTarget(target);
                    setShareModalVisible(true);
                  }, 250);
                }}
                style={{
                  minHeight: 48,
                  borderRadius: 14,
                  backgroundColor: theme.colors.primary,
                  justifyContent: "center",
                  alignItems: "center",
                  flexDirection: "row",
                  gap: 8,
                  marginTop: 16,
                }}
              >
                <Share2 size={18} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "700" }}>Share</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* -- Share Folder Modal --------------------------------------- */}
      <ShareFolderModal
        visible={isShareModalVisible}
        onClose={closeShareModal}
        targetItem={shareTarget}
      />
    </View>
  );
}

const createStyles = (theme: any, gridSize: number) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 16,
      minHeight: 72,
      flexWrap: "wrap",
    },
    headerCenter: { flex: 1, alignItems: "flex-start" },
    headerTitle: {
      fontWeight: "700",
      color: theme.colors.textHeading,
      fontSize: 23,
      letterSpacing: -0.4,
      fontFamily: "Inter_700Bold",
    },
    headerActions: {
      flexDirection: "row",
      gap: 8,
      width: "100%",
      justifyContent: "flex-end",
      marginTop: 8,
    },
    iconBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      justifyContent: "center",
      alignItems: "center",

      backgroundColor: theme.colors.card,
    },
    breadcrumbBar: {
      backgroundColor: theme.colors.card,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      height: 40,
      justifyContent: "center",
    },
    crumbLink: {
      fontSize: 12,
      color: theme.colors.primary,
      fontWeight: "600",
      fontFamily: "Inter_600SemiBold",
    },
    crumbSep: {
      fontSize: 12,
      color: theme.colors.textBody,
      fontFamily: "Inter_400Regular",
    },
    tabBar: { height: 66 },
    tab: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: theme.colors.background,
      minHeight: 44,
      borderRadius: 24,
    },
    tabActive: { backgroundColor: theme.colors.primary },
    tabInner: { flexDirection: "row", alignItems: "center", gap: 6 },
    tabText: {
      fontSize: 12,
      color: theme.colors.textBody,
      fontWeight: "600",
      fontFamily: "Inter_600SemiBold",
    },
    tabTextActive: { color: "#fff" },
    scrollArea: { flex: 1, paddingHorizontal: 20 },
    emptyState: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 60,
    },
    emptyText: {
      color: theme.colors.textBody,
      fontSize: 15,
      marginTop: 16,
      fontFamily: "Inter_400Regular",
    },
    fileCard: {
      backgroundColor: theme.colors.card,
      borderRadius: 24,
      marginBottom: 10,
    },
    fileCardInner: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 16,
      borderBottomColor: theme.colors.border,
      paddingHorizontal: 16,
      borderBottomWidth: 0,
      minHeight: 88,
    },
    folderRow: {},
    fileCardSelected: { backgroundColor: theme.colors.infoSoft },
    fileDetails: { flex: 1, justifyContent: "center" },
    fileName: {
      fontSize: 15,
      fontWeight: "500",
      marginBottom: 2,
      fontFamily: "Inter_600SemiBold",
    },
    fileMeta: {
      fontSize: 12,
      fontWeight: "400",
      fontFamily: "Inter_400Regular",
    },
    moreBtn: {
      padding: 4,
      justifyContent: "center",
      alignItems: "center",
      width: 44,
      height: 44,
    },
    gridContainer: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    gridCard: {
      width: gridSize,
      backgroundColor: theme.colors.card,
      overflow: "hidden",
      borderWidth: 0,
      borderColor: theme.colors.border,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 10,
      borderRadius: 24,
      shadowOpacity: 0,
      elevation: 0,
    },
    gridIcon: {
      width: "100%",
      height: gridSize * 0.7,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: theme.colors.inputBg,
    },
    gridLabel: {
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 14,
      gap: 4,
    },
    gridName: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.colors.textHeading,
      fontFamily: "Inter_600SemiBold",
    },
    gridMeta: {
      fontSize: 11,
      fontWeight: "500",
      color: theme.colors.textBody,
      fontFamily: "Inter_500Medium",
    },
    gridCheckbox: {
      position: "absolute",
      top: 8,
      right: 8,
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: "#fff",
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: "rgba(255,255,255,0.3)",
    },
    fab: {
      position: "absolute",
      bottom: 40,
      right: 24,
      backgroundColor: theme.colors.primary,
      justifyContent: "center",
      alignItems: "center",
      ...theme.shadows.soft,
      elevation: 10,
      zIndex: 10,
      width: 56,
      height: 56,
      borderRadius: 18,
    },
    bulkBar: {
      position: "absolute",
      left: 12,
      right: 12,
      zIndex: 12,
      borderWidth: 1,
      borderRadius: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-around",
      paddingVertical: 8,
      ...theme.shadows.soft,
      elevation: 12,
    },
    bulkAction: {
      flex: 1,
      minHeight: 50,
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
    },
    bulkActionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    centeredModal: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    modalCard: {
      width: "100%",
      backgroundColor: theme.colors.card,
      padding: 24,
      ...theme.shadows.card,
      maxWidth: 440,
      borderRadius: 20,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: theme.colors.textHeading,
      marginBottom: 16,
      fontFamily: "Inter_700Bold",
    },
    modalSub: {
      fontSize: 14,
      color: theme.colors.textBody,
      marginBottom: 20,
      fontFamily: "Inter_400Regular",
    },
    modalInput: {
      width: "100%",
      height: 50,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      fontSize: 16,
      marginBottom: 20,
      color: theme.colors.textHeading,
      fontFamily: "Inter_400Regular",
    },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
    modalBtn: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      backgroundColor: theme.colors.background,
      minHeight: 44,
      borderRadius: 12,
    },
    modalBtnText: {
      color: theme.colors.textHeading,
      fontWeight: "600",
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
    },
    searchContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.background,
      borderRadius: 28,
      paddingHorizontal: 12,
      height: 56,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    searchInput: {
      flex: 1,
      marginLeft: 10,
      fontSize: 15,
      color: theme.colors.textHeading,
      fontFamily: "Inter_400Regular",

      minWidth: 0,
    },
    optionItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 16,
      backgroundColor: theme.colors.background,
      marginBottom: 8,
    },
    optionText: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.colors.textHeading,
      fontFamily: "Inter_600SemiBold",
    },
  });
