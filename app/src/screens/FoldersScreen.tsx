import { LibraryShortcut } from "../components/LibraryUI";
import { PlatformAlert as Alert } from "../utils/alert";
import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  FlatList,
  StyleSheet,
  useWindowDimensions,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  MoreHorizontal,
  ArrowLeft,
  Folder as FolderIcon,
  Plus,
  SortAsc,
  SortDesc,
  Filter,
  Search,
  X,
  Pin,
  ChevronRight,
  Share2,
  Pencil,
  Trash2,
  CloudDownload,
  SearchCheck,
} from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "../services/apiClient";
import { EmptyState } from "../ui/EmptyState";
import { FolderCardSkeleton } from "../ui/Skeleton";
import ShareFolderModal from "../components/ShareFolderModal";
import AppButton from "../components/AppButton";
import IconButton from "../components/IconButton";
import { formatFolderMeta } from "../utils/folderMeta";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useFileRefresh } from "../utils/events";
import { syncAfterFileMutation } from "../services/fileStateSync";
import { sanitizeFileName } from "../utils/fileSafety";

const CARD_MARGIN = 12;

const HOME_FOLDER_PREVIEW_LIMIT = 4;
const HOME_PINNED_FOLDERS_KEY = "@home_pinned_folder_ids_v1";

const FOLDER_THEMES = [
  { bg: "#F0FDF4", icon: "#22C55E" }, // Green
  { bg: "#FEFCE8", icon: "#EAB308" }, // Yellow
  { bg: "#FFF1F2", icon: "#F43F5E" }, // Pink
  { bg: "#F5F3FF", icon: "#8B5CF6" }, // Purple
  { bg: "#ECFEFF", icon: "#06B6D4" }, // Cyan
];
const getFolderColor = (index: number) =>
  FOLDER_THEMES[index % FOLDER_THEMES.length];
const asArray = <T,>(value: any): T[] => (Array.isArray(value) ? value : []);

const SORT_OPTIONS = [
  {
    key: "created_at_DESC",
    label: "Newest First",
    icon: SortDesc,
    col: "created_at",
    order: "DESC",
  },
  {
    key: "created_at_ASC",
    label: "Oldest First",
    icon: SortAsc,
    col: "created_at",
    order: "ASC",
  },
  {
    key: "name_ASC",
    label: "Name A-Z",
    icon: SortAsc,
    col: "name",
    order: "ASC",
  },
  {
    key: "name_DESC",
    label: "Name Z-A",
    icon: SortDesc,
    col: "name",
    order: "DESC",
  },
  {
    key: "file_count_DESC",
    label: "Most Files",
    icon: SortDesc,
    col: "file_count",
    order: "DESC",
  },
  {
    key: "file_count_ASC",
    label: "Fewest Files",
    icon: SortAsc,
    col: "file_count",
    order: "ASC",
  },
];

const createStyles = (theme: any, C: any, cardWidth: number) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingTop: Platform.OS === "web" ? 20 : 12,
      paddingBottom: 12,
      backgroundColor: C.background,
      borderBottomWidth: 0,
      zIndex: 10,
      paddingHorizontal: 20,
      paddingVertical: 12,
      minHeight: 72,
    },
    headerTitleWrapper: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 12,
      alignItems: "center",
      zIndex: -1,
      height: 44,
      justifyContent: "center",
    },
    headerTitle: {
      color: C.textHeading,
      opacity: 0,
      fontSize: 24,
      lineHeight: 32,
      letterSpacing: -0.6,
      fontWeight: "600",
      fontFamily: "Inter_600SemiBold",
    },
    headerLeft: { flex: 1, alignItems: "flex-start" },
    headerRight: { flex: 1, alignItems: "flex-end", paddingRight: 4 },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: "transparent",
    },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    addBtn: {
      backgroundColor: C.primaryLight,
      justifyContent: "center",
      alignItems: "center",
      ...theme.shadows.elevation1,
      width: 44,
      height: 44,
      borderRadius: 22,

      elevation: 0,
      shadowOpacity: 0,
    },
    sortBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      height: 44,
      paddingHorizontal: 12,
      borderRadius: 22,
      backgroundColor: C.card,
      ...theme.shadows.elevation1,

      elevation: 0,
      shadowOpacity: 0,
    },
    sortBtnText: {
      fontSize: 13,
      fontWeight: "600",
      color: C.primary,
      marginLeft: 6,
      fontFamily: "Inter_600SemiBold",
    },
    titleSection: { paddingHorizontal: 24, marginTop: 12, marginBottom: 16 },
    pageTitle: {
      fontWeight: "700",
      color: C.textHeading,
      marginBottom: 4,
      fontSize: 32,
      lineHeight: 40,
      letterSpacing: -0.8,
      fontFamily: "Inter_700Bold",
    },
    statsSubtitle: {
      fontSize: 14,
      color: C.textBody,
      fontWeight: "500",
      fontFamily: "Inter_500Medium",
    },
    searchWrap: { paddingHorizontal: 24, marginBottom: 20 },
    searchBar: {
      backgroundColor: C.card,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      gap: 12,
      ...theme.shadows.elevation1,
      height: 56,
      borderRadius: 28,

      shadowOpacity: 0,
      elevation: 0,
      borderWidth: 1,
      borderColor: C.border,
    },
    searchBarFocused: { shadowOpacity: 0.08, shadowRadius: 16, elevation: 3 },
    searchInput: {
      flex: 1,
      color: C.textHeading,
      fontSize: 15,
      fontWeight: "500",
      fontFamily: "Inter_500Medium",

      minWidth: 0,
    },
    scrollArea: { flex: 1 },
    allFilesRow: {
      minHeight: 90,
      borderRadius: 26,
      borderWidth: 0,
      borderColor: C.mode === "dark" ? C.border : "#DCE8FF",
      backgroundColor: C.mode === "dark" ? C.card : "#EEF4FF",
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      marginBottom: 24,
      gap: 14,
    },
    allFilesIcon: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: C.mode === "dark" ? C.background : "#FFFFFF",
      justifyContent: "center",
      alignItems: "center",
    },
    allFilesCopy: { flex: 1, minWidth: 0 },
    allFilesTitle: {
      color: C.textHeading,
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
    },
    allFilesSubtitle: {
      color: C.textBody,
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      marginTop: 3,
    },
    sectionHeading: {
      color: C.textHeading,
      fontSize: 17,
      fontFamily: "Inter_700Bold",
      marginBottom: 14,
    },
    gridContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
    },
    folderCard: {
      width: cardWidth,
      padding: 18,
      marginBottom: 12,
      minHeight: 166,
      borderWidth: 0,
      borderColor: C.border,
      justifyContent: "space-between",
      backgroundColor: C.card,
      shadowColor: C.mode === "dark" ? "#000" : "#1E293B",
      shadowOffset: { width: 0, height: 8 },
      shadowRadius: 24,
      borderRadius: 26,
      shadowOpacity: 0,
      elevation: 0,
    },
    folderCardPressed: { transform: [{ scale: 0.98 }] },
    folderCardHovered: { transform: [{ translateY: -2 }], shadowOpacity: 0.08 },
    cardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
    },
    pinnedBadge: {
      position: "absolute",
      right: -4,
      bottom: -4,
      width: 22,
      height: 22,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 11,
      borderWidth: 2,
      borderColor: C.card,
      backgroundColor: C.mode === "dark" ? C.background : "#EFF6FF",
    },
    iconBox: {
      width: 48,
      height: 48,
      borderRadius: 16,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: C.background,
    },
    cardFooter: { marginTop: 16 },
    folderName: {
      color: C.textHeading,
      marginBottom: 4,
      marginTop: 0,
      letterSpacing: -0.2,
      fontSize: 16,
      fontWeight: "600",
      fontFamily: "Inter_600SemiBold",
    },
    folderMeta: {
      color: C.textBody,
      fontWeight: "300",
      fontSize: 12,
      lineHeight: 18,
      fontFamily: "Inter_400Regular",
    },
    moreBtn: {
      width: 44,
      height: 44,
      borderRadius: 16,
      backgroundColor: "transparent",
      minWidth: 36,
      minHeight: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(15,23,42,0.4)",
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    modalCard: {
      width: "100%",
      backgroundColor: C.card,
      padding: 24,
      ...theme.shadows.elevation2,
      maxWidth: 440,
      borderRadius: 20,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: C.textHeading,
      marginBottom: 16,
      fontFamily: "Inter_700Bold",
    },
    modalInput: {
      width: "100%",
      height: 48,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      fontSize: 16,
      marginBottom: 20,
      color: C.textHeading,
      backgroundColor: C.background,
      fontFamily: "Inter_400Regular",
    },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
    sortModalOverlay: {
      flex: 1,
      backgroundColor: "rgba(15,23,42,0.4)",
      justifyContent: "flex-end",
    },
    sortSheet: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 12,
      backgroundColor: C.card,
    },
    sortHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      alignSelf: "center",
      marginBottom: 16,
      backgroundColor: C.border,
    },
    sortSheetTitle: {
      fontSize: 18,
      fontWeight: "700",
      marginBottom: 16,
      color: C.textHeading,
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
    sortRowText: {
      flex: 1,
      fontSize: 15,
      fontWeight: "500",
      color: C.textHeading,
      fontFamily: "Inter_500Medium",
    },
    sortCheck: {
      width: 20,
      height: 20,
      borderRadius: 10,
      justifyContent: "center",
      alignItems: "center",
    },
    confirmTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: C.textHeading,
      marginBottom: 6,
      fontFamily: "Inter_700Bold",
    },
    confirmSub: {
      fontSize: 14,
      color: C.textBody,
      marginBottom: 20,
      fontFamily: "Inter_400Regular",
    },
    confirmActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 10,
    },
    dangerBtn: {
      height: 44,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: C.danger,
      justifyContent: "center",
      alignItems: "center",
    },
    dangerBtnText: {
      color: "#fff",
      fontSize: 14,
      fontWeight: "700",
      fontFamily: "Inter_700Bold",
    },
  });

export default function FoldersScreen({ navigation }: any) {
  const { theme } = useTheme();
  const C = theme.colors;
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const pinnedKey = HOME_PINNED_FOLDERS_KEY + ":" + String(user?.id || "guest");
  const { width } = useWindowDimensions();
  const columns = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const cardWidth = Math.max(
    100,
    (width - 48 - CARD_MARGIN * (columns - 1)) / columns,
  );
  const styles = useMemo(
    () => createStyles(theme, C, cardWidth),
    [theme, C, cardWidth],
  );

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [folders, setFolders] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [hoveredFolderId, setHoveredFolderId] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState("created_at_DESC");
  const [showSortModal, setShowSortModal] = useState(false);

  const [isCreateModalVisible, setCreateModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const [isRenameModalVisible, setRenameModalVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<any>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [pinnedFolderIds, setPinnedFolderIds] = useState<string[]>([]);

  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareTarget, setShareTarget] = useState<any>(null);
  const closeShareModal = () => {
    setShareModalVisible(false);
    setTimeout(() => setShareTarget(null), 220);
  };

  const [optionsTarget, setOptionsTarget] = useState<any>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<any>(null);
  const openFolder = (folder: any) =>
    navigation.navigate("FolderFiles", {
      folderId: folder.id,
      folderName: folder.name,
    });

  useEffect(() => {
    void fetchFolders();
  }, [sortKey]);

  useFileRefresh(() => {
    void fetchFolders();
  });

  useEffect(() => {
    const loadPinned = async () => {
      try {
        const raw = await AsyncStorage.getItem(pinnedKey);
        if (!raw) {
          setPinnedFolderIds([]);
          return;
        }
        const parsed = JSON.parse(raw);
        setPinnedFolderIds(
          Array.isArray(parsed) ? parsed.map((id: any) => String(id)) : [],
        );
      } catch {
        setPinnedFolderIds([]);
      }
    };
    void loadPinned();
  }, [pinnedKey]);

  const fetchFolders = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const sortOpt =
        SORT_OPTIONS.find((s) => s.key === sortKey) ?? SORT_OPTIONS[0];
      const res = await apiClient.get(
        `/files/folders?sort=${sortOpt.col}&order=${sortOpt.order}`,
      );
      if (!res.data.success) throw new Error("Could not load folders");
      if (res.data.success) {
        const safeFolders = asArray(res.data.folders);
        setFolders(
          safeFolders.map((f: any, i: number) => ({
            ...f,
            color: getFolderColor(
              Array.from(String(f.id)).reduce(
                (sum, char) => sum + char.charCodeAt(0),
                0,
              ),
            ),
          })),
        );
      }
    } catch {
      setLoadError(
        "Could not load folders. Check your connection and try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    const nextFolderName = sanitizeFileName(newFolderName, "New Folder");
    if (!nextFolderName || isCreatingFolder) return;
    setIsCreatingFolder(true);
    try {
      const res = await apiClient.post("/files/folder", {
        name: nextFolderName,
      });
      if (res.data.success) {
        setNewFolderName("");
        setCreateModalVisible(false);
        await fetchFolders();
        syncAfterFileMutation();
      }
    } catch (e: any) {
      Alert.alert(
        "Error",
        e.response?.data?.error || "Could not create folder",
      );
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleRenameFolder = async () => {
    const nextName = sanitizeFileName(renameValue, "Folder");
    if (!nextName || !renameTarget || isRenamingFolder) return;
    setIsRenamingFolder(true);
    try {
      const res = await apiClient.patch(`/files/folder/${renameTarget.id}`, {
        name: nextName,
      });
      if (res.data.success) {
        setRenameModalVisible(false);
        setRenameTarget(null);
        await fetchFolders();
        syncAfterFileMutation();
      }
    } catch (e: any) {
      Alert.alert(
        "Error",
        e.response?.data?.error || "Could not rename folder",
      );
    } finally {
      setIsRenamingFolder(false);
    }
  };

  const persistPinnedFolders = async (ids: string[]) => {
    setPinnedFolderIds(ids);
    try {
      await AsyncStorage.setItem(pinnedKey, JSON.stringify(ids));
    } catch {
      Alert.alert("Error", "Could not save Home folder selection");
    }
  };

  const togglePinnedOnHome = async (folder: any) => {
    const folderId = String(folder?.id ?? "");
    if (!folderId) return;
    if (pinnedFolderIds.includes(folderId)) {
      await persistPinnedFolders(
        pinnedFolderIds.filter((id) => id !== folderId),
      );
      return;
    }
    if (pinnedFolderIds.length >= HOME_FOLDER_PREVIEW_LIMIT) {
      Alert.alert(
        "Limit reached",
        `You can pin up to ${HOME_FOLDER_PREVIEW_LIMIT} folders on Home.`,
      );
      return;
    }
    await persistPinnedFolders([...pinnedFolderIds, folderId]);
  };

  const confirmDeleteFolder = async (folder: any) => {
    try {
      await apiClient.delete(`/files/folder/${folder.id}`);
      await fetchFolders();
      syncAfterFileMutation();
    } catch (e: any) {
      Alert.alert("Error", e.response?.data?.error || "Could not delete");
    }
  };

  const openFolderMenu = (folder: any) => setOptionsTarget(folder);

  const filtered = folders.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const currentSort =
    SORT_OPTIONS.find((s) => s.key === sortKey) ?? SORT_OPTIONS[0];
  const sortSubtitle = currentSort.label
    .toLowerCase()
    .replace(" first", "")
    .replace(" a-z", "");

  const handleBack = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation?.navigate?.("MainTabs", { screen: "Home" });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <IconButton
            variant="ghost"
            style={styles.backBtn}
            accessibilityLabel="Back"
            onPress={handleBack}
            icon={<ArrowLeft color={C.textHeading} size={22} />}
          />
        </View>
        <View style={styles.headerRight}>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.sortBtn}
              onPress={() => setShowSortModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Sort folders"
            >
              {isLoading && folders.length > 0 ? (
                <ActivityIndicator
                  size="small"
                  color={C.primary}
                  accessibilityLabel="Refreshing folders"
                />
              ) : (
                <Filter size={16} color={C.primary} />
              )}
              <Text style={styles.sortBtnText}>{sortSubtitle}</Text>
            </TouchableOpacity>
            <IconButton
              variant="surface"
              style={styles.addBtn}
              accessibilityLabel="Create folder"
              onPress={() => setCreateModalVisible(true)}
              icon={<Plus color={C.textHeading} size={22} />}
            />
          </View>
        </View>
      </View>

      <View style={styles.titleSection}>
        <Text style={styles.pageTitle}>Folders</Text>
        <Text style={styles.statsSubtitle}>
          {folders.length} folder{folders.length !== 1 ? "s" : ""} ·{" "}
          {sortSubtitle}
        </Text>
      </View>

      <View style={styles.searchWrap}>
        <View
          style={[styles.searchBar, isSearchFocused && styles.searchBarFocused]}
        >
          <Search color={C.textBody} size={16} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search folders"
            placeholderTextColor={C.textBody}
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel="Search folders"
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
          />
          {!!searchQuery && (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={{
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X color={C.textBody} size={16} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        key={`folder-grid-${columns}`}
        style={styles.scrollArea}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 120 }}
        columnWrapperStyle={{ justifyContent: "space-between" }}
        numColumns={columns}
        data={isLoading && folders.length === 0 ? [] : filtered}
        keyExtractor={(item: any) => String(item.id)}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={C.primary}
            onRefresh={() => {
              setRefreshing(true);
              fetchFolders().finally(() => setRefreshing(false));
            }}
          />
        }
        ListHeaderComponent={
          <View>
            {!!loadError && folders.length > 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void fetchFolders()}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  backgroundColor: C.card,
                  marginBottom: 14,
                }}
              >
                <Text
                  style={{ color: C.danger, fontFamily: "Inter_600SemiBold" }}
                >
                  Could not refresh folders · Try again
                </Text>
              </Pressable>
            )}
            {!searchQuery && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Browse all files"
                style={({ pressed }) => [
                  styles.allFilesRow,
                  pressed && styles.folderCardPressed,
                ]}
                onPress={() => navigation.navigate("AllFiles")}
              >
                <View style={styles.allFilesIcon}>
                  <FolderIcon color={C.primary} size={23} strokeWidth={2} />
                </View>
                <View style={styles.allFilesCopy}>
                  <Text style={styles.allFilesTitle}>All files</Text>
                  <Text style={styles.allFilesSubtitle}>
                    Browse everything in your drive
                  </Text>
                </View>
                <ChevronRight color={C.textBody} size={19} />
              </Pressable>
            )}

            {!searchQuery && (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 12,
                  marginBottom: 24,
                }}
              >
                <LibraryShortcut
                  title="Find files"
                  detail="Search by type or tag"
                  icon={SearchCheck}
                  tone="violet"
                  onPress={() => navigation.navigate("Discover")}
                />
                <LibraryShortcut
                  title="Offline"
                  detail="Saved on this device"
                  icon={CloudDownload}
                  tone="mint"
                  onPress={() => navigation.navigate("OfflineFiles")}
                />
              </View>
            )}
            <Text style={styles.sectionHeading}>
              {searchQuery ? "Search results" : "Your folders"}
            </Text>
          </View>
        }
        ListEmptyComponent={
          isLoading && folders.length === 0 ? (
            <View style={styles.gridContainer}>
              {[1, 2, 3, 4].map((i) => (
                <FolderCardSkeleton key={i} />
              ))}
            </View>
          ) : (
            <EmptyState
              title={
                loadError
                  ? "Folders unavailable"
                  : searchQuery
                    ? "No results found"
                    : "No folders here"
              }
              description={
                loadError ||
                (searchQuery
                  ? "Try a different folder name"
                  : "Create a folder to organize your files")
              }
              iconType={searchQuery ? "search" : "folder"}
              buttonText={loadError ? "Try again" : undefined}
              onButtonPress={loadError ? () => void fetchFolders() : undefined}
            />
          )
        }
        renderItem={({ item: folder }: { item: any }) => (
          <View
            style={[
              styles.folderCard,
              {
                padding: 0,
                backgroundColor:
                  theme.mode === "dark"
                    ? C.card
                    : folder.color?.bg || "#EAF2FF",
              },
              hoveredFolderId === String(folder.id) && styles.folderCardHovered,
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={"Open folder " + folder.name}
              style={({ pressed }) => ({
                flex: 1,
                padding: 18,
                justifyContent: "space-between",
                opacity: pressed ? 0.8 : 1,
              })}
              onPress={() => openFolder(folder)}
              onHoverIn={() => setHoveredFolderId(String(folder.id))}
              onHoverOut={() => setHoveredFolderId(null)}
            >
              <View
                style={[
                  styles.iconBox,
                  { backgroundColor: (folder.color?.icon || C.primary) + "15" },
                ]}
              >
                <FolderIcon
                  color={folder.color?.icon || C.primary}
                  size={26}
                  fill={folder.color?.icon || C.primary}
                  strokeWidth={1.7}
                />
                {pinnedFolderIds.includes(String(folder.id)) && (
                  <View style={styles.pinnedBadge}>
                    <Pin color={C.primary} size={11} />
                  </View>
                )}
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.folderName} numberOfLines={1}>
                  {folder.name}
                </Text>
                <Text style={styles.folderMeta}>
                  {formatFolderMeta(folder)}
                </Text>
              </View>
            </Pressable>
            <IconButton
              variant="ghost"
              accessibilityLabel={"Options for folder " + folder.name}
              style={[
                styles.moreBtn,
                { position: "absolute", right: 8, top: 12 },
              ]}
              onPress={() => openFolderMenu(folder)}
              icon={<MoreHorizontal color={C.textBody} size={20} />}
            />
          </View>
        )}
      />

      <Modal
        visible={isCreateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setCreateModalVisible(false);
          setRenameModalVisible(false);
          setDeleteConfirmTarget(null);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Folder</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Folder name"
              placeholderTextColor={C.textBody}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
              onSubmitEditing={handleCreateFolder}
            />
            <View style={styles.modalActions}>
              <AppButton
                label="Cancel"
                variant="secondary"
                onPress={() => {
                  setCreateModalVisible(false);
                  setNewFolderName("");
                }}
              />
              <AppButton
                label="Create"
                onPress={handleCreateFolder}
                loading={isCreatingFolder}
                disabled={
                  !sanitizeFileName(newFolderName, "").trim() ||
                  isCreatingFolder
                }
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={isRenameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename Folder</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="New folder name"
              placeholderTextColor={C.textBody}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              onSubmitEditing={handleRenameFolder}
            />
            <View style={styles.modalActions}>
              <AppButton
                label="Cancel"
                variant="secondary"
                onPress={() => {
                  setRenameModalVisible(false);
                  setRenameTarget(null);
                }}
              />
              <AppButton
                label="Rename"
                onPress={handleRenameFolder}
                loading={isRenamingFolder}
                disabled={
                  !sanitizeFileName(renameValue, "").trim() || isRenamingFolder
                }
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showSortModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowSortModal(false);
          setOptionsTarget(null);
        }}
      >
        <TouchableOpacity
          style={styles.sortModalOverlay}
          activeOpacity={1}
          onPress={() => setShowSortModal(false)}
        >
          <View style={styles.sortSheet}>
            <View style={styles.sortHandle} />
            <Text style={styles.sortSheetTitle}>Sort by</Text>
            {SORT_OPTIONS.map((opt) => {
              const OptIcon = opt.icon;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.sortRow,
                    sortKey === opt.key && {
                      backgroundColor: `${C.primary}18`,
                    },
                  ]}
                  onPress={() => {
                    setSortKey(opt.key);
                    setShowSortModal(false);
                  }}
                >
                  <OptIcon
                    size={18}
                    color={sortKey === opt.key ? C.primary : C.textBody}
                  />
                  <Text
                    style={[
                      styles.sortRowText,
                      {
                        color: sortKey === opt.key ? C.primary : C.textHeading,
                      },
                      sortKey === opt.key && { fontWeight: "700" },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {sortKey === opt.key && (
                    <View
                      style={[styles.sortCheck, { backgroundColor: C.primary }]}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: "800",
                        }}
                      >
                        ✓
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
            <View style={{ height: 24 }} />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={!!optionsTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setOptionsTarget(null)}
      >
        <TouchableOpacity
          style={styles.sortModalOverlay}
          activeOpacity={1}
          onPress={() => setOptionsTarget(null)}
        >
          <View style={styles.sortSheet}>
            <View style={styles.sortHandle} />
            <Text style={styles.sortSheetTitle}>
              Manage "{optionsTarget?.name}"
            </Text>

            <TouchableOpacity
              style={styles.sortRow}
              accessibilityRole="button"
              accessibilityLabel={
                pinnedFolderIds.includes(String(optionsTarget?.id))
                  ? "Remove folder from Home"
                  : "Pin folder to Home"
              }
              onPress={() => {
                const target = optionsTarget;
                setOptionsTarget(null);
                if (target) void togglePinnedOnHome(target);
              }}
            >
              <Pin size={18} color={C.primary} />
              <Text style={[styles.sortRowText, { color: C.textHeading }]}>
                {pinnedFolderIds.includes(String(optionsTarget?.id))
                  ? "Remove from Home"
                  : "Pin to Home"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sortRow}
              accessibilityRole="button"
              accessibilityLabel="Share folder"
              onPress={() => {
                const target = optionsTarget;
                setOptionsTarget(null);
                setTimeout(() => {
                  if (!target) return;
                  setShareTarget({
                    id: target.id,
                    name: target.name,
                    result_type: "folder",
                  });
                  setShareModalVisible(true);
                }, 250);
              }}
            >
              <Share2 size={18} color={C.primary} />
              <Text style={[styles.sortRowText, { color: C.textHeading }]}>
                Share Folder
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sortRow}
              accessibilityRole="button"
              accessibilityLabel="Rename folder"
              onPress={() => {
                const target = optionsTarget;
                setOptionsTarget(null);
                setTimeout(() => {
                  if (!target) return;
                  setRenameTarget(target);
                  setRenameValue(target.name);
                  setRenameModalVisible(true);
                }, 250);
              }}
            >
              <Pencil size={18} color={C.textBody} />
              <Text style={[styles.sortRowText, { color: C.textHeading }]}>
                Rename Folder
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sortRow,
                {
                  borderTopWidth: 1,
                  borderTopColor: C.border,
                  paddingTop: 16,
                  marginTop: 12,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Move folder to trash"
              onPress={() => {
                const target = optionsTarget;
                setOptionsTarget(null);
                setTimeout(() => setDeleteConfirmTarget(target), 250);
              }}
            >
              <Trash2 size={18} color={C.danger} />
              <Text
                style={[
                  styles.sortRowText,
                  { color: C.danger, fontWeight: "700" },
                ]}
              >
                Delete Folder
              </Text>
            </TouchableOpacity>

            <View style={{ height: 24 }} />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={!!deleteConfirmTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.confirmTitle}>Delete Folder</Text>
            <Text style={styles.confirmSub}>
              Move "{deleteConfirmTarget?.name}" to trash?
            </Text>
            <View style={styles.confirmActions}>
              <AppButton
                label="Cancel"
                variant="secondary"
                onPress={() => setDeleteConfirmTarget(null)}
              />
              <TouchableOpacity
                style={styles.dangerBtn}
                onPress={async () => {
                  const target = deleteConfirmTarget;
                  setDeleteConfirmTarget(null);
                  if (target) await confirmDeleteFolder(target);
                }}
              >
                <Text style={styles.dangerBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ShareFolderModal
        visible={shareModalVisible}
        onClose={closeShareModal}
        targetItem={shareTarget}
      />
    </View>
  );
}
