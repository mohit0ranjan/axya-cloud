import {
  Fragment,
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
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Platform,
  Modal,
  KeyboardAvoidingView,
  Dimensions,
  Animated,
  Easing,
  Image as RNImage,
  PanResponder,
  Vibration,
} from "react-native";
import {
  Search,
  Folder,
  Upload,
  HardDrive,
  Mic,
  User,
  X,
  FileText,
  MoreHorizontal,
  FolderPlus,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { showActionSheet, showDestructiveConfirm } from "../utils/alert";

import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "../services/apiClient";
import { AuthContext } from "../context/AuthContext";
import { useUpload } from "../context/UploadContext";
import { useApiCacheStore } from "../context/ApiCacheStore";
import { useToast } from "../context/ToastContext";
import { FileCardSkeleton, SkeletonBlock, ContentFadeIn } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import { useTheme } from "../context/ThemeContext";
import { layout } from "../ui/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FileListItem from "../components/FileListItem";
import FileQuickActions from "../components/FileQuickActions";
import { useServerKeepAlive } from "../hooks/useServerKeepAlive";
import {
  HomeActions,
  HomeCategories,
  HomeStorage,
} from "../components/HomePanels";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { ErrorState } from "../ui/ErrorState";
import { ChevronRight } from "lucide-react-native";
import VoiceRecorder from "../components/VoiceRecorder";
import AppButton from "../components/AppButton";
import IconButton from "../components/IconButton";
import { formatFolderMeta } from "../utils/folderMeta";
import { useFileRefresh, useOptimisticFiles } from "../utils/events";
import {
  dedupeFilesById,
  normalizeItems,
  sortFilesLatestFirst,
  syncAfterFileMutation,
} from "../services/fileStateSync";

const { width } = Dimensions.get("window");
const HOME_RECENT_FILES_PREVIEW_LIMIT = 3;
const HOME_TOTAL_FOLDER_CARDS_LIMIT = 4; // includes "All Files" card
const HOME_USER_FOLDER_PREVIEW_LIMIT = Math.max(
  0,
  HOME_TOTAL_FOLDER_CARDS_LIMIT - 1,
);
const HOME_PINNED_FOLDERS_KEY = "@home_pinned_folder_ids_v1";

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B";
  const k = 1024,
    s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + s[i];
};

const formatDate = (d: string) => {
  if (!d) return "";
  const date = new Date(d);
  const now = new Date();
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const asArray = <T,>(value: any): T[] => (Array.isArray(value) ? value : []);

const createStyles = (C: Record<string, string>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    /* Header */
    header: {
      width: "100%",
      maxWidth: 720,
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 24,
      paddingBottom: 20,
      backgroundColor: C.bg,
      minHeight: 82,
    },
    cloudIconContainer: {
      width: 44,
      height: 44,
      borderRadius: 15,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
    },
    greeting: {
      color: C.text,
      fontFamily: "Inter_700Bold",
      fontSize: 25,
      lineHeight: 32,
      letterSpacing: -0.7,
    },
    subGreeting: {
      color: C.muted,
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      lineHeight: 19,
    },
    headerIconBtn: {
      width: 44,
      height: 44,
      backgroundColor: C.card,
      justifyContent: "center",
      alignItems: "center",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 10,
      borderRadius: 14,
      shadowOpacity: 0,
      elevation: 0,
    },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: C.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 3,
      borderColor: C.card,
    },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: C.card,
      borderRadius: 28,
      paddingLeft: 18,
      paddingRight: 8,
      minHeight: 54,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      fontSize: 14,
      color: C.text,
      fontFamily: "Inter_400Regular",
      paddingVertical: 14,
    },

    scrollContent: {
      paddingTop: 0,
      paddingBottom: 112,
      width: "100%",
      maxWidth: 720,
      alignSelf: "center",
    },

    /* Section headers */
    sectionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 24,
      marginBottom: 12,
    },
    sectionLabel: {
      color: C.text,
      fontFamily: "Inter_600SemiBold",
      fontSize: 17,
      letterSpacing: -0.3,
      flex: 1,
      minWidth: 0,
    },
    seeAllBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: 44,
      justifyContent: "center",
    },
    seeAllText: {
      color: C.primary,
      fontFamily: "Inter_500Medium",
      fontSize: 12,
    },

    /* Folder cards */
    folderGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      gap: 12,
      paddingHorizontal: 24,
      marginBottom: 24,
      paddingTop: 6,
    },
    folderGridCard: {
      width: "47%",
      padding: 18,
      minHeight: 145,
      justifyContent: "space-between",
      backgroundColor: C.card,
      borderRadius: 24,
    },
    folderGridTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    folderIconBox: {
      width: 44,
      height: 44,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
    },
    folderGridName: {
      color: C.text,
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      lineHeight: 22,
      marginTop: 14,
      marginBottom: 4,
      letterSpacing: -0.2,
    },
    folderGridMeta: {
      color: C.muted,
      fontWeight: "300",
      fontSize: 12,
      lineHeight: 18,
      fontFamily: "Inter_400Regular",
    },

    emptyFolder: {
      marginHorizontal: layout.padding.screen,
      height: 80,
      backgroundColor: C.card,
      borderRadius: layout.radiusMap.card,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      borderWidth: 1.5,
      borderColor: C.border,
      borderStyle: "dashed",
      marginBottom: 20,
    },
    emptyFolderText: {
      fontSize: 14,
      fontWeight: "600",
      color: C.primary,
      fontFamily: "Inter_600SemiBold",
    },

    /* File list */
    fileList: {
      paddingHorizontal: 24,
      gap: 12,
      paddingBottom: 48,
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
    },
    fileRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: C.card,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 20,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.04,
      shadowRadius: 10,
      elevation: 2,
    },
    fileIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      justifyContent: "center",
      alignItems: "center",
    },
    fileInfo: { flex: 1, marginHorizontal: 14 },
    fileName: {
      fontSize: 14,
      fontWeight: "600",
      color: C.text,
      marginBottom: 4,
      fontFamily: "Inter_600SemiBold",
    },
    fileMeta: {
      fontSize: 12,
      color: C.muted,
      fontWeight: "300",
      fontFamily: "Inter_400Regular",
    },

    /* Empty state */
    emptyFiles: { alignItems: "center", paddingTop: 40, paddingBottom: 32 },
    emptyFilesIcon: {
      width: 76,
      height: 76,
      borderRadius: layout.radiusMap.card,
      backgroundColor: C.card,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 18,
      shadowColor: "#000",
      shadowOpacity: 0.04,
      shadowRadius: 10,
      elevation: 2,
    },
    emptyTitle: {
      fontSize: 17,
      fontWeight: "600",
      color: C.text,
      marginBottom: 8,
      fontFamily: "Inter_600SemiBold",
    },
    emptyBody: {
      fontSize: 14,
      color: C.muted,
      textAlign: "center",
      lineHeight: 20,
      fontFamily: "Inter_400Regular",
    },

    fab: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: "#5B7CFF",
      justifyContent: "center",
      alignItems: "center",
      shadowColor: "#5B7CFF",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 10,
      marginTop: -20,
    },

    /* Modals / Sheets */
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: C.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      padding: 28,
      paddingBottom: 48,
    },
    sheetHandle: {
      width: 40,
      height: 4,
      backgroundColor: C.border,
      borderRadius: 2,
      alignSelf: "center",
      marginBottom: 24,
    },
    sheetTitle: {
      fontWeight: "700",
      color: C.text,
      marginBottom: 24,
      fontSize: 22,
      letterSpacing: -0.4,
      fontFamily: "Inter_700Bold",
    },
    sheetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
      minHeight: 68,
    },
    sheetRowIcon: {
      width: 48,
      height: 48,
      borderRadius: 16,
      justifyContent: "center",
      alignItems: "center",
    },
    sheetRowTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: C.text,
      marginBottom: 2,
      fontFamily: "Inter_600SemiBold",
    },
    sheetRowSub: {
      fontSize: 13,
      color: C.muted,
      fontFamily: "Inter_400Regular",
    },

    centeredOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    modalCard: {
      width: "100%",
      backgroundColor: C.card,
      padding: 24,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 24,
      elevation: 16,
      maxWidth: 440,
      borderRadius: 20,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: C.text,
      marginBottom: 16,
      fontFamily: "Inter_700Bold",
    },
    filePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: C.primarySoft,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginBottom: 20,
    },
    filePillText: {
      flex: 1,
      fontSize: 14,
      fontWeight: "600",
      color: C.primary,
      fontFamily: "Inter_600SemiBold",
    },
    modalLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: C.muted,
      marginBottom: 8,
      fontFamily: "Inter_600SemiBold",
    },
    modalInput: {
      borderWidth: 1.5,
      borderColor: C.border,
      borderRadius: 16,
      paddingHorizontal: 16,
      height: 50,
      fontSize: 15,
      color: C.text,
      marginBottom: 24,
      backgroundColor: C.inputBg,
      fontFamily: "Inter_400Regular",
    },
    folderChip: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: C.inputBg,
      borderWidth: 1.5,
      borderColor: C.border,
      borderRadius: 20,
      marginRight: 10,
    },
    folderChipSelected: {
      backgroundColor: C.primarySoft,
      borderColor: C.primary,
    },
    folderChipText: {
      fontSize: 14,
      color: C.muted,
      fontWeight: "600",
      fontFamily: "Inter_600SemiBold",
    },
    folderChipTextSelected: {
      color: C.primary,
    },
    modalBtns: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
    btnCancel: {
      paddingHorizontal: layout.padding.screen,
      paddingVertical: 13,
      borderRadius: 12,
      backgroundColor: C.border,
    },
    btnCancelTxt: {
      fontWeight: "600",
      color: C.text,
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
    },
    btnConfirm: {
      paddingHorizontal: 24,
      paddingVertical: 13,
      borderRadius: 12,
      backgroundColor: C.primary,
      shadowColor: C.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    btnConfirmTxt: {
      fontWeight: "600",
      color: "#fff",
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
    },
  });

// ------------------------------------------------------------------------------
const AnimatedFolderCard = ({
  folder,
  isAllFiles = false,
  idx = 0,
  s,
  C,
  onPress,
  onMoreOptions,
}: any) => {
  const scale = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();
  const name = isAllFiles ? "All files" : folder?.name || "Folder";
  const colours = ["#3B82F6", "#10B981", "#F59E0B", "#F43F5E", "#8B5CF6"];
  const colour = isAllFiles ? C.primary : colours[idx % colours.length];
  const animate = (toValue: number) => {
    if (reducedMotion) return;
    Animated.spring(scale, {
      toValue,
      speed: 24,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };
  return (
    <Animated.View
      style={{ width: "47.5%", paddingTop: 9, transform: [{ scale }] }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 16,
          width: 62,
          height: 30,
          borderRadius: 12,
          backgroundColor: colour + "28",
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 5,
          left: 25,
          right: 12,
          height: 40,
          borderRadius: 18,
          backgroundColor: colour + "12",
        }}
      />
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={
          isAllFiles ? "Browse all files" : "Open folder " + name
        }
        activeOpacity={0.9}
        onPressIn={() => animate(0.99)}
        onPressOut={() => animate(1)}
        onPress={onPress}
        style={[
          s.folderGridCard,
          {
            width: "100%",
            backgroundColor: C.card,
            borderWidth: 1,
            borderColor: C.border,
          },
        ]}
      >
        <View style={s.folderGridTop}>
          <View style={[s.folderIconBox, { backgroundColor: colour + "12" }]}>
            <Folder color={colour} size={24} fill={colour} strokeWidth={1.3} />
          </View>
        </View>
        <View>
          <Text style={s.folderGridName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={s.folderGridMeta} numberOfLines={2}>
            {isAllFiles ? "Everything in your drive" : formatFolderMeta(folder)}
          </Text>
        </View>
      </TouchableOpacity>
      <IconButton
        variant="ghost"
        size={44}
        accessibilityLabel={"Options for " + name}
        onPress={onMoreOptions}
        style={{
          position: "absolute",
          top: 17,
          right: 6,
          backgroundColor: "transparent",
        }}
        icon={<MoreHorizontal color={C.muted} size={18} />}
      />
    </Animated.View>
  );
};

export default function HomeScreen({ navigation, route }: any) {
  const { logout, user, token } = useContext(AuthContext);
  const { showToast } = useToast();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  useServerKeepAlive(); // ? keeps Render from sleeping every 10 minutes

  // Dynamic color tokens — react to dark/light mode (memoized to prevent style recalculation)
  const C = useMemo(
    () => ({
      bg: theme.colors.background,
      card: theme.colors.card,
      primary: theme.colors.primary,
      primaryDark: isDark ? "#4B6EF5" : "#2B4FD8",
      accent: theme.colors.accent,
      danger: theme.colors.danger,
      success: theme.colors.success,
      purple: isDark ? "#A855F7" : "#9B59B6",
      text: theme.colors.textHeading,
      muted: theme.colors.textBody,
      border: theme.colors.border,
      storageGrad1: theme.colors.gradientStart,
      storageGrad2: theme.colors.gradientMid,
      storageGrad3: theme.colors.gradientEnd,
      storageImages: theme.colors.storageImages,
      storageVideos: theme.colors.storageVideos,
      storageFiles: theme.colors.storageFiles,
      inputBg: theme.colors.inputBg,
      primarySoft: isDark ? "rgba(88,117,255,0.16)" : "#EEF1FD",
      warningSoft: isDark ? "rgba(245,158,11,0.16)" : "#FEF3C7",
      warning: "#D97706",
      dangerSoft: isDark ? "rgba(239,68,68,0.16)" : "#FEE2E2",
      tealSoft: isDark ? "rgba(13,148,136,0.16)" : "#CCFBF1",
      purpleSoft: isDark ? "rgba(147,51,234,0.16)" : "#F3E8FF",
      successSoft: isDark ? "rgba(22,163,74,0.16)" : "#DCFCE7",
    }),
    [theme.colors, isDark],
  );

  // Memoized styles that react to theme changes
  const s = useMemo(() => createStyles(C), [C]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<any>({});
  const [recentFiles, setRecentFiles] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [pinnedFolderIds, setPinnedFolderIds] = useState<string[]>([]);
  const [allFolders, setAllFolders] = useState<any[]>([]);
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(null);

  // Search
  const [loadError, setLoadError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // FAB
  const [fabOpen, setFabOpen] = useState(false);
  const fabSheetTranslateY = useRef(new Animated.Value(48)).current;
  const fabSheetBackdrop = useRef(new Animated.Value(0)).current;

  // Upload modal
  const [uploadModal, setUploadModal] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [pickedFiles, setPickedFiles] = useState<any[]>([]);
  const chatTarget = "me";

  // Folder modal
  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Rename folder modal
  const [renameFolderModal, setRenameFolderModal] = useState(false);
  const [renameFolderTarget, setRenameFolderTarget] = useState<any>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const mountedRef = useRef(true);
  const loadGeneration = useRef(0);

  const { homeData, setHomeData } = useApiCacheStore();

  // Debounced search
  useEffect(() => {
    let isCancelled = false;
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    setSearching(true);
    setSearchError("");
    const t = setTimeout(async () => {
      if (isCancelled) return;
      setSearching(true);
      try {
        const res = await apiClient.get(
          `/files/search?q=${encodeURIComponent(q)}`,
        );
        if (!res.data.success) throw Error("Search unavailable");
        if (!isCancelled)
          setSearchResults(
            Array.isArray(res.data.results) ? res.data.results : [],
          );
      } catch {
        if (!isCancelled) {
          setSearchResults([]);
          setSearchError(
            "Search could not load. Check your connection and try again.",
          );
        }
      } finally {
        if (!isCancelled) setSearching(false);
      }
    }, 350);
    return () => {
      isCancelled = true;
      clearTimeout(t);
    };
  }, [searchQuery, searchRevision]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      loadGeneration.current++;
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (homeData) {
      // Instantiate instantly from cache to prevent empty screen flashes
      setStats(homeData.stats);
      setRecentFiles(
        normalizeItems(asArray(homeData.files), "created_at_DESC"),
      );
      setAllFolders(
        normalizeItems(asArray(homeData.folders), "created_at_DESC"),
      );
      setLoading(false);
    }
    void hydratePinnedFolderIds();
    load();
  }, []);

  useFileRefresh(() => {
    load(true);
  });

  useOptimisticFiles(setRecentFiles);

  useEffect(() => {
    if (!route?.params?.openFabAt) return;
    setFabOpen(true);
    navigation.setParams?.({ openFabAt: undefined });
  }, [route?.params?.openFabAt, navigation]);

  const triggerHaptic = useCallback((ms: number = 8) => {
    if (Platform.OS === "web") return;
    Vibration.vibrate(ms);
  }, []);

  useEffect(() => {
    if (!fabOpen) return;
    fabSheetTranslateY.setValue(48);
    fabSheetBackdrop.setValue(0);
    Animated.parallel([
      Animated.spring(fabSheetTranslateY, {
        toValue: 0,
        damping: 18,
        stiffness: 220,
        mass: 0.9,
        useNativeDriver: true,
      }),
      Animated.timing(fabSheetBackdrop, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fabOpen, fabSheetBackdrop, fabSheetTranslateY]);

  const closeFabSheet = useCallback(
    (onClosed?: () => void) => {
      Animated.parallel([
        Animated.timing(fabSheetBackdrop, {
          toValue: 0,
          duration: 170,
          useNativeDriver: true,
        }),
        Animated.timing(fabSheetTranslateY, {
          toValue: 64,
          duration: 170,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setFabOpen(false);
        onClosed?.();
      });
    },
    [fabSheetBackdrop, fabSheetTranslateY],
  );

  const fabSheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dy) > 6 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy <= 0) return;
          fabSheetTranslateY.setValue(Math.min(gesture.dy, 220));
          fabSheetBackdrop.setValue(Math.max(0, 1 - gesture.dy / 240));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 90 || gesture.vy > 0.9) {
            closeFabSheet();
            return;
          }
          Animated.parallel([
            Animated.spring(fabSheetTranslateY, {
              toValue: 0,
              damping: 18,
              stiffness: 220,
              mass: 0.9,
              useNativeDriver: true,
            }),
            Animated.timing(fabSheetBackdrop, {
              toValue: 1,
              duration: 140,
              useNativeDriver: true,
            }),
          ]).start();
        },
      }),
    [closeFabSheet, fabSheetBackdrop, fabSheetTranslateY],
  );

  useEffect(() => {
    const unsubscribe = navigation?.addListener?.("focus", () => {
      void hydratePinnedFolderIds();
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    setFolders(buildHomeFolders(allFolders, pinnedFolderIds));
  }, [allFolders, pinnedFolderIds]);

  const load = async (isRefresh = false) => {
    const currentLoad = ++loadGeneration.current;
    setLoadError("");
    if (!homeData && !isRefresh) setLoading(true);
    try {
      // These reads are independent; apiClient coordinates backend readiness.
      const [statsRes, filesRes, foldersRes] = await Promise.all([
        apiClient.get("/files/stats"),
        apiClient.get(
          `/files?limit=${HOME_RECENT_FILES_PREVIEW_LIMIT}&sort=created_at&order=DESC`,
        ),
        apiClient.get("/files/folders"),
      ]);
      if (![statsRes, filesRes, foldersRes].every((res) => res.data.success))
        throw Error("Could not refresh drive metadata");
      if (currentLoad !== loadGeneration.current) return;
      const newStats = statsRes.data.success ? statsRes.data : {};
      const newFiles = filesRes.data.success
        ? normalizeItems(asArray(filesRes.data.files), "created_at_DESC")
        : [];
      const newFolders = foldersRes.data.success
        ? normalizeItems(asArray(foldersRes.data.folders), "created_at_DESC")
        : [];

      if (!mountedRef.current) return;
      setHomeData({
        stats: newStats,
        files: newFiles,
        folders: newFolders,
        recent: [],
        activity: [],
      });
      setStats(newStats);
      setRecentFiles(newFiles);
      setAllFolders(newFolders);
    } catch (e) {
      if (currentLoad !== loadGeneration.current) return;
      if (mountedRef.current)
        setLoadError("Could not refresh your drive. Pull down to retry.");
      if (mountedRef.current && !homeData)
        showToast("Could not load dashboard", "error");
    } finally {
      if (mountedRef.current && currentLoad === loadGeneration.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const { addUpload } = useUpload();

  const normalizeFolderId = (value: any) => String(value ?? "").trim();

  const buildHomeFolders = useCallback(
    (sourceFolders: any[], pinnedIds: string[]) => {
      if (!Array.isArray(sourceFolders) || sourceFolders.length === 0)
        return [];
      const byId = new Map(
        sourceFolders.map((f) => [normalizeFolderId(f?.id), f]),
      );
      const pinnedExisting = pinnedIds
        .map((id) => byId.get(id))
        .filter(Boolean) as any[];
      const pinnedSet = new Set(
        pinnedExisting.map((f) => normalizeFolderId(f?.id)),
      );
      const fallback = sourceFolders.filter(
        (f) => !pinnedSet.has(normalizeFolderId(f?.id)),
      );
      return [...pinnedExisting, ...fallback].slice(
        0,
        HOME_USER_FOLDER_PREVIEW_LIMIT,
      );
    },
    [],
  );

  const persistPinnedFolderIds = useCallback(
    async (ids: string[]) => {
      try {
        await AsyncStorage.setItem(
          HOME_PINNED_FOLDERS_KEY + ":" + String(user?.id || "guest"),
          JSON.stringify(ids),
        );
      } catch {
        showToast("Could not save Home folders", "error");
      }
    },
    [showToast, user?.id],
  );

  const hydratePinnedFolderIds = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(
        HOME_PINNED_FOLDERS_KEY + ":" + String(user?.id || "guest"),
      );
      if (!raw) {
        setPinnedFolderIds([]);
        return;
      }
      const parsed = JSON.parse(raw);
      const next = Array.isArray(parsed)
        ? parsed.map((id: any) => normalizeFolderId(id)).filter(Boolean)
        : [];
      setPinnedFolderIds(next);
    } catch {
      setPinnedFolderIds([]);
    }
  }, [user?.id]);

  const toggleFolderPinned = useCallback(
    (folder: any) => {
      const id = normalizeFolderId(folder?.id);
      if (!id) return;
      const isPinned = pinnedFolderIds.includes(id);
      let nextIds: string[] = [];

      if (isPinned) {
        nextIds = pinnedFolderIds.filter((x) => x !== id);
        showToast("Removed from Home folders");
      } else {
        if (pinnedFolderIds.length >= HOME_USER_FOLDER_PREVIEW_LIMIT) {
          showToast(
            `Only ${HOME_USER_FOLDER_PREVIEW_LIMIT} folders can be pinned`,
            "error",
          );
          return;
        }
        nextIds = [...pinnedFolderIds, id];
        showToast("Pinned to Home folders");
      }

      setPinnedFolderIds(nextIds);
      void persistPinnedFolderIds(nextIds);
    },
    [persistPinnedFolderIds, pinnedFolderIds, showToast],
  );

  // Memoized handler for file item press
  const handleFileItemPress = useCallback(
    (item: any, isFolder: boolean) => {
      if (isFolder) {
        navigation.navigate("FolderFiles", {
          folderId: item.id,
          folderName: item.name,
        });
      } else {
        const previewFiles = searchQuery.trim() ? searchResults : recentFiles;
        const idx = previewFiles.findIndex((f) => f.id === item.id);
        navigation.navigate("FilePreview", {
          files: previewFiles,
          initialIndex: idx === -1 ? 0 : idx,
          file: item,
        });
      }
    },
    [navigation, recentFiles, searchQuery, searchResults],
  );

  const handlePickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      setPickedFiles(res.assets);
      setUploadFolderId(null);
      setUploadModal(true);
    } catch {
      showToast("Could not pick file", "error");
    }
  };

  const handleUpload = () => {
    if (!pickedFiles || pickedFiles.length === 0) return;
    setUploadModal(false);
    const fileAssets = pickedFiles
      .filter((f) => !!f?.uri && !!f?.name)
      .map((f) => ({
        uri: f.uri,
        name: f.name,
        size: f.size ?? 0,
        mimeType: f.mimeType ?? "application/octet-stream",
      }));
    if (fileAssets.length === 0) {
      showToast("No valid files selected", "error");
      return;
    }
    addUpload(fileAssets, uploadFolderId, chatTarget);
    setPickedFiles([]);
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim() || isCreatingFolder) return;
    setIsCreatingFolder(true);
    try {
      const nextName = folderName.trim();
      const res = await apiClient.post("/files/folder", { name: nextName });
      if (res.data.success) {
        showToast("Folder created!");
        setFolderName("");
        setFolderModal(false);
        const createdFolder = res.data.folder;
        if (createdFolder?.id) {
          setAllFolders((prev) => {
            const dedupedPrev = prev.filter(
              (item) => String(item?.id) !== String(createdFolder.id),
            );
            return normalizeItems(
              [createdFolder, ...dedupedPrev],
              "created_at_DESC",
            );
          });
        }
        // Keep UI responsive with optimistic update, then reconcile in background.
        void load(true);
        syncAfterFileMutation();
      }
    } catch (e: any) {
      showToast(e.response?.data?.error || "Could not create folder", "error");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleRenameFolder = async () => {
    if (!renameFolderName.trim() || !renameFolderTarget || isRenamingFolder)
      return;
    setIsRenamingFolder(true);
    try {
      const res = await apiClient.patch(
        `/files/folder/${renameFolderTarget.id}`,
        { name: renameFolderName.trim() },
      );
      if (res.data.success) {
        showToast("Folder renamed!");
        setRenameFolderModal(false);
        setRenameFolderTarget(null);
        load();
        syncAfterFileMutation();
      }
    } catch (e: any) {
      showToast(e.response?.data?.error || "Could not rename folder", "error");
    } finally {
      setIsRenamingFolder(false);
    }
  };

  const handleAllFilesOptions = useCallback(() => {
    showActionSheet("All Files", "Choose an action", [
      {
        text: "Open All Files",
        onPress: () => navigation.navigate("AllFiles"),
      },
      { text: "Open Folders", onPress: () => navigation.navigate("Folders") },
    ]);
  }, [navigation]);

  // Options Modal
  const [optionsTarget, setOptionsTarget] = useState<any>(null);

  const hasSearch = Boolean(searchQuery.trim());

  const displayItems = useMemo(
    () =>
      hasSearch
        ? searchResults
        : recentFiles.slice(0, HOME_RECENT_FILES_PREVIEW_LIMIT),
    [recentFiles, hasSearch, searchResults],
  );

  const memoizedFileList = useMemo(() => {
    const isMedia = (item: any) =>
      /^(image|video)\//.test(String(item.mime_type || ""));
    const items = hasSearch
      ? displayItems
      : [
          ...displayItems.filter(isMedia),
          ...displayItems.filter((item) => !isMedia(item)),
        ];
    return items.map((item: any) => {
      const gallery =
        !hasSearch && /^(image|video)\//.test(String(item.mime_type || ""));
      return (
        <View key={item.id} style={{ width: gallery ? "47.5%" : "100%" }}>
          <FileListItem
            item={item}
            variant={gallery ? "gallery" : "library"}
            token={token}
            apiBaseUrl={apiClient.defaults.baseURL || ""}
            theme={theme}
            isDark={isDark}
            onPress={handleFileItemPress}
            onOptionsPress={(item) => setOptionsTarget(item)}
          />
        </View>
      );
    });
  }, [
    displayItems,
    hasSearch,
    token,
    apiClient.defaults.baseURL,
    theme,
    isDark,
    handleFileItemPress,
  ]);

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <View style={[s.header, { paddingTop: Math.max(insets.top + 8, 16) }]}>
        <View style={s.cloudIconContainer}>
          <RNImage
            source={require("../../assets/icon.png")}
            style={{ width: 30, height: 30 }}
            resizeMode="contain"
          />
        </View>
        <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
          <Text style={s.subGreeting} numberOfLines={1}>
            Hello, {user?.name?.split(" ")[0] || user?.username || "there"}
          </Text>
          <Text style={s.greeting}>Axya Drive</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          onPress={() => navigation.navigate("Profile")}
          style={s.avatar}
        >
          <Text
            style={{
              color: C.primary,
              fontFamily: "Inter_600SemiBold",
              fontSize: 18,
            }}
          >
            {String(user?.name || user?.username || "A")
              .slice(0, 1)
              .toUpperCase()}
          </Text>
        </TouchableOpacity>
      </View>
      <View
        style={{
          width: "100%",
          maxWidth: 720,
          alignSelf: "center",
          paddingHorizontal: 24,
          marginBottom: 18,
        }}
      >
        <View style={s.searchBar}>
          <Search color={C.muted} size={19} />
          <TextInput
            style={s.searchInput}
            accessibilityLabel="Search files"
            placeholder="Search your drive"
            placeholderTextColor={C.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {!!hasSearch && (
            <IconButton
              variant="ghost"
              accessibilityLabel="Clear home search"
              onPress={() => setSearchQuery("")}
              icon={<X color={C.muted} size={18} />}
            />
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={C.primary}
            onRefresh={() => {
              setRefreshing(true);
              void apiClient
                .post("/files/sync", { limit: 20 }, { timeout: 20_000 })
                .then(({ data }) => {
                  if (data.missing || data.stale)
                    showToast(
                      "Some files are no longer available in Telegram.",
                      "error",
                    );
                })
                .catch(() => {
                  /* Loading cached metadata remains available when Telegram is offline. */
                })
                .finally(() => {
                  void load(true);
                });
            }}
          />
        }
      >
        {!!loadError && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Retry loading home"
            onPress={() => void load(true)}
            style={{
              marginHorizontal: 24,
              padding: 14,
              backgroundColor: C.card,
              borderRadius: 18,
              marginBottom: 16,
            }}
          >
            <Text style={{ color: C.danger, fontSize: 12 }}>{loadError}</Text>
          </TouchableOpacity>
        )}
        {!hasSearch && (
          <>
            <HomeStorage
              stats={stats}
              loading={loading}
              navigation={navigation}
            />
            <HomeActions
              navigation={navigation}
              onUpload={() => {
                void handlePickFile();
              }}
              onRecord={() => setVoiceOpen(true)}
              onNewFolder={() => setFolderModal(true)}
            />
            <HomeCategories navigation={navigation} />
          </>
        )}

        {/* -----------------------------------------------------------
                    FOLDERS SECTION
                ----------------------------------------------------------- */}
        {!hasSearch && (
          <>
            <View style={s.sectionRow}>
              <Text style={s.sectionLabel}>Your folders</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="View all folders"
                style={s.seeAllBtn}
                onPress={() => navigation.navigate("Folders")}
              >
                <Text style={s.seeAllText}>See all</Text>
                <ChevronRight color={C.primary} size={16} />
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={s.folderGrid}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={`folder-skel-${i}`} style={s.folderGridCard}>
                    <SkeletonBlock
                      width={44}
                      height={44}
                      borderRadius={12}
                      delay={i * 80}
                    />
                    <SkeletonBlock
                      width="70%"
                      height={13}
                      borderRadius={6}
                      style={{ marginTop: 28 }}
                      delay={i * 80 + 40}
                    />
                    <SkeletonBlock
                      width="50%"
                      height={11}
                      borderRadius={5}
                      style={{ marginTop: 6 }}
                      delay={i * 80 + 80}
                    />
                  </View>
                ))}
              </View>
            ) : loadError && !stats.success ? (
              <Text
                style={{
                  color: C.muted,
                  marginHorizontal: 24,
                  marginBottom: 24,
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                }}
              >
                Folders couldn't load. Retry above.
              </Text>
            ) : folders.length === 0 ? (
              <View style={s.folderGrid}>
                <AnimatedFolderCard
                  isAllFiles
                  s={s}
                  C={C}
                  onPress={() => navigation.navigate("AllFiles")}
                  onMoreOptions={handleAllFilesOptions}
                />
                <View style={{ width: "47.5%", paddingTop: 9 }}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Create your first folder"
                    onPress={() => setFolderModal(true)}
                    activeOpacity={0.85}
                    style={[
                      s.folderGridCard,
                      {
                        width: "100%",
                        backgroundColor: C.primarySoft,
                        borderWidth: 1,
                        borderColor: C.primary + "20",
                      },
                    ]}
                  >
                    <View
                      style={[s.folderIconBox, { backgroundColor: C.card }]}
                    >
                      <FolderPlus
                        color={C.primary}
                        size={24}
                        strokeWidth={1.7}
                      />
                    </View>
                    <View>
                      <Text style={[s.folderGridName, { color: C.primary }]}>
                        New folder
                      </Text>
                      <Text style={s.folderGridMeta}>Keep things together</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <ContentFadeIn visible={!loading}>
                <View style={s.folderGrid}>
                  <AnimatedFolderCard
                    isAllFiles={true}
                    s={s}
                    C={C}
                    onPress={() => navigation.navigate("AllFiles")}
                    onMoreOptions={handleAllFilesOptions}
                  />
                  {folders.map((folder, idx) => (
                    <AnimatedFolderCard
                      key={folder.id}
                      folder={folder}
                      idx={idx}
                      s={s}
                      C={C}
                      onPress={() =>
                        navigation.navigate("FolderFiles", {
                          folderId: folder.id,
                          folderName: folder.name,
                        })
                      }
                      onMoreOptions={() => {
                        if (Platform.OS === "web") {
                          setOptionsTarget({
                            ...folder,
                            result_type: "folder",
                            mime_type: "inode/directory",
                          });
                        } else {
                          showActionSheet(
                            "Folder Options",
                            `Manage "${folder.name}"`,
                            [
                              {
                                text: pinnedFolderIds.includes(
                                  normalizeFolderId(folder.id),
                                )
                                  ? "Remove from Home"
                                  : "Pin to Home",
                                onPress: () => toggleFolderPinned(folder),
                              },
                              {
                                text: "Rename",
                                onPress: () => {
                                  setRenameFolderTarget(folder);
                                  setRenameFolderName(folder.name);
                                  setRenameFolderModal(true);
                                },
                              },
                              {
                                text: "Delete Folder",
                                destructive: true,
                                onPress: async () => {
                                  try {
                                    const res = await apiClient.delete(
                                      `/files/folder/${folder.id}`,
                                    );
                                    if (res.data.success) {
                                      showToast("Folder moved to trash");
                                      load();
                                      syncAfterFileMutation();
                                    }
                                  } catch (e: any) {
                                    showToast(
                                      e.response?.data?.error ||
                                        "Could not delete folder",
                                      "error",
                                    );
                                  }
                                },
                              },
                            ],
                          );
                        }
                      }}
                    />
                  ))}
                </View>
              </ContentFadeIn>
            )}
          </>
        )}

        {/* -----------------------------------------------------------
                    RECENT FILES
                ----------------------------------------------------------- */}
        <View style={[s.sectionRow, { marginTop: hasSearch ? 0 : 8 }]}>
          <Text style={s.sectionLabel}>
            {hasSearch ? `Results for "${searchQuery}"` : "Recent files"}
          </Text>
          {!hasSearch && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="View all recent files"
              style={s.seeAllBtn}
              onPress={() => navigation.navigate("AllFiles")}
            >
              <Text style={s.seeAllText}>See all</Text>
              <ChevronRight color={C.primary} size={16} />
            </TouchableOpacity>
          )}
        </View>

        {loading || searching ? (
          <View style={{ paddingHorizontal: layout.padding.screen }}>
            {[0, 1, 2, 3].map((i) => (
              <FileCardSkeleton key={i} index={i} />
            ))}
          </View>
        ) : searchError && hasSearch ? (
          <ErrorState
            title="Search unavailable"
            message={searchError}
            onRetry={() => setSearchRevision((value) => value + 1)}
            style={{ paddingVertical: 32, flex: 0 }}
          />
        ) : loadError && !stats.success && !hasSearch ? (
          <ErrorState
            title="Your files couldn't load"
            message="Check your connection and try again."
            onRetry={() => void load(true)}
            style={{ paddingVertical: 32, flex: 0 }}
          />
        ) : displayItems.length === 0 ? (
          <EmptyState
            title={hasSearch ? "No results found" : "No files yet"}
            description={
              hasSearch
                ? "Try a different keyword"
                : "Upload a file to get started"
            }
            iconType={hasSearch ? "search" : "file"}
            style={{ paddingVertical: 40, flex: 0 }}
          />
        ) : (
          <ContentFadeIn visible={!loading && !searching}>
            <View style={s.fileList}>{memoizedFileList}</View>
          </ContentFadeIn>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* ---------------------------------------------------------------
                FAB ACTION SHEET
            --------------------------------------------------------------- */}
      <Modal
        visible={fabOpen}
        transparent
        animationType="none"
        onRequestClose={() => closeFabSheet()}
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: "#000", opacity: fabSheetBackdrop },
            ]}
          />
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => closeFabSheet()}
          />

          <Animated.View
            {...fabSheetPanResponder.panHandlers}
            style={[
              s.sheet,
              {
                backgroundColor: C.card,
                transform: [{ translateY: fabSheetTranslateY }],
              },
            ]}
          >
            <View style={s.sheetHandle} />
            <Text style={[s.sheetTitle, { color: C.text }]}>Create New</Text>
            <TouchableOpacity
              style={s.sheetRow}
              onPress={() => closeFabSheet(() => setVoiceOpen(true))}
              activeOpacity={0.7}
            >
              <View
                style={[s.sheetRowIcon, { backgroundColor: C.primarySoft }]}
              >
                <Mic color={C.primary} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetRowTitle}>Record audio</Text>
                <Text style={s.sheetRowSub}>
                  Record, review and save a voice note
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.sheetRow}
              onPress={() => {
                triggerHaptic();
                closeFabSheet(() => {
                  void handlePickFile();
                });
              }}
              activeOpacity={0.7}
            >
              <View
                style={[s.sheetRowIcon, { backgroundColor: C.primarySoft }]}
              >
                <Upload color={C.primary} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetRowTitle}>Upload File</Text>
                <Text style={s.sheetRowSub}>
                  Pick any file from your device
                </Text>
              </View>
              <MoreHorizontal color={C.muted} size={18} />
            </TouchableOpacity>

            <TouchableOpacity
              style={s.sheetRow}
              onPress={() => {
                triggerHaptic();
                closeFabSheet(() => setFolderModal(true));
              }}
              activeOpacity={0.7}
            >
              <View
                style={[s.sheetRowIcon, { backgroundColor: C.warningSoft }]}
              >
                <Folder color={C.warning} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetRowTitle}>New Folder</Text>
                <Text style={s.sheetRowSub}>Organise your files</Text>
              </View>
              <MoreHorizontal color={C.muted} size={18} />
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      {/* ---------------------------------------------------------------
                UPLOAD CONFIRM MODAL
            --------------------------------------------------------------- */}
      <Modal visible={uploadModal} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={s.centeredOverlay}
        >
          <View style={[s.modalCard, { backgroundColor: C.card }]}>
            <Text style={[s.modalTitle, { color: C.text }]}>Upload File</Text>
            <View style={s.filePill}>
              <FileText color={C.primary} size={18} />
              <Text style={s.filePillText} numberOfLines={1}>
                {pickedFiles.length > 1
                  ? `${pickedFiles.length} files selected`
                  : pickedFiles[0]?.name}
              </Text>
            </View>
            <Text style={s.modalLabel}>Upload To Folder</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 20 }}
            >
              <TouchableOpacity
                style={[
                  s.folderChip,
                  uploadFolderId === null && s.folderChipSelected,
                ]}
                onPress={() => setUploadFolderId(null)}
              >
                <Text
                  style={[
                    s.folderChipText,
                    uploadFolderId === null && s.folderChipTextSelected,
                  ]}
                >
                  Home (Root)
                </Text>
              </TouchableOpacity>
              {allFolders.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    s.folderChip,
                    uploadFolderId === f.id && s.folderChipSelected,
                  ]}
                  onPress={() => setUploadFolderId(f.id)}
                >
                  <Text
                    style={[
                      s.folderChipText,
                      uploadFolderId === f.id && s.folderChipTextSelected,
                    ]}
                  >
                    {f.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={s.modalBtns}>
              <AppButton
                label="Cancel"
                variant="secondary"
                onPress={() => {
                  setUploadModal(false);
                  setPickedFiles([]);
                }}
              />
              <AppButton
                label="Upload"
                onPress={handleUpload}
                disabled={pickedFiles.length === 0}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---------------------------------------------------------------
                NEW FOLDER MODAL
            --------------------------------------------------------------- */}
      <Modal visible={folderModal} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={s.centeredOverlay}
        >
          <View style={[s.modalCard, { backgroundColor: C.card }]}>
            <Text style={[s.modalTitle, { color: C.text }]}>New Folder</Text>
            <TextInput
              style={[
                s.modalInput,
                {
                  color: C.text,
                  borderColor: C.border,
                  backgroundColor: C.inputBg,
                },
              ]}
              value={folderName}
              onChangeText={setFolderName}
              placeholder="Folder name…"
              placeholderTextColor={C.muted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreateFolder}
            />
            <View style={s.modalBtns}>
              <AppButton
                label="Cancel"
                variant="secondary"
                onPress={() => {
                  setFolderModal(false);
                  setFolderName("");
                }}
              />
              <AppButton
                label="Create"
                onPress={handleCreateFolder}
                loading={isCreatingFolder}
                disabled={!folderName.trim() || isCreatingFolder}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* -- Rename Folder Modal --------------------------------- */}
      <Modal visible={renameFolderModal} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={s.centeredOverlay}
        >
          <View style={[s.modalCard, { backgroundColor: C.card }]}>
            <Text style={[s.modalTitle, { color: C.text }]}>Rename Folder</Text>
            <TextInput
              style={[
                s.modalInput,
                {
                  color: C.text,
                  borderColor: C.border,
                  backgroundColor: C.inputBg,
                },
              ]}
              value={renameFolderName}
              onChangeText={setRenameFolderName}
              placeholder="New folder name…"
              placeholderTextColor={C.muted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleRenameFolder}
            />
            <View style={s.modalBtns}>
              <AppButton
                label="Cancel"
                variant="secondary"
                onPress={() => {
                  setRenameFolderModal(false);
                  setRenameFolderTarget(null);
                }}
              />
              <AppButton
                label="Rename"
                onPress={handleRenameFolder}
                loading={isRenamingFolder}
                disabled={!renameFolderName.trim() || isRenamingFolder}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* -- Folder Options Modal -- */}
      {(optionsTarget?.result_type === "folder" ||
        optionsTarget?.mime_type === "inode/directory") && (
        <Modal
          visible={true}
          transparent
          animationType="fade"
          onRequestClose={() => setOptionsTarget(null)}
        >
          <View style={s.overlay}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss folder menu"
              style={StyleSheet.absoluteFillObject}
              onPress={() => setOptionsTarget(null)}
            />
            <View style={[s.sheet, { backgroundColor: C.card }]}>
              <View style={s.sheetHandle} />
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Text
                  style={[
                    s.sheetTitle,
                    { color: C.text, flex: 1, marginBottom: 0 },
                  ]}
                  numberOfLines={1}
                >
                  {optionsTarget?.name}
                </Text>
                <IconButton
                  accessibilityLabel="Close folder menu"
                  onPress={() => setOptionsTarget(null)}
                  icon={<X size={20} color={C.muted} />}
                />
              </View>

              <TouchableOpacity
                accessibilityRole="button"
                style={s.sheetRow}
                onPress={() => {
                  setOptionsTarget(null);
                  toggleFolderPinned(optionsTarget);
                }}
              >
                <Text style={s.sheetRowTitle}>
                  {pinnedFolderIds.includes(
                    normalizeFolderId(optionsTarget?.id),
                  )
                    ? "Remove from Home"
                    : "Pin to Home"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                style={s.sheetRow}
                onPress={() => {
                  setOptionsTarget(null);
                  setRenameFolderTarget(optionsTarget);
                  setRenameFolderName(optionsTarget?.name);
                  setRenameFolderModal(true);
                }}
              >
                <Text style={s.sheetRowTitle}>Rename Folder</Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                style={[
                  s.sheetRow,
                  {
                    borderTopWidth: 1,
                    borderTopColor: C.border,
                    paddingTop: 16,
                    marginTop: 12,
                  },
                ]}
                onPress={async () => {
                  const targetId = optionsTarget?.id;
                  const targetName = optionsTarget?.name;
                  setOptionsTarget(null);
                  const confirmed = await showDestructiveConfirm(
                    "Delete Folder",
                    `Move "${targetName}" to trash?`,
                    "Delete",
                  );
                  if (confirmed) {
                    try {
                      const res = await apiClient.delete(
                        `/files/folder/${targetId}`,
                      );
                      if (res.data.success) {
                        showToast("Folder moved to trash");
                        load();
                        syncAfterFileMutation();
                      }
                    } catch (e: any) {
                      showToast(
                        e.response?.data?.error || "Could not delete folder",
                        "error",
                      );
                    }
                  }
                }}
              >
                <Text
                  style={[
                    s.sheetRowTitle,
                    { color: "red", fontWeight: "bold" },
                  ]}
                >
                  Delete Folder
                </Text>
              </TouchableOpacity>
              <View style={{ height: 24 }} />
            </View>
          </View>
        </Modal>
      )}

      {/* -- File Quick Actions -- */}
      {optionsTarget &&
        !(
          optionsTarget.result_type === "folder" ||
          optionsTarget.mime_type === "inode/directory"
        ) && (
          <FileQuickActions
            item={optionsTarget}
            visible={true}
            onClose={() => setOptionsTarget(null)}
            onRefresh={() => load(true)}
          />
        )}

      {voiceOpen && (
        <VoiceRecorder
          close={() => setVoiceOpen(false)}
          folderId={uploadFolderId}
          chatTarget={chatTarget}
        />
      )}
    </View>
  );
}
