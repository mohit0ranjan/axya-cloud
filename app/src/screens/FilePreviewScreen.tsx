import { useReducedMotion } from "../hooks/useReducedMotion";
import { FileIcon } from "../components/FileIcon";
import { PlatformAlert as Alert } from "../utils/alert";
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  FlatList,
  ScrollView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Vibration,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Download,
  Star,
  Share2,
  MoreHorizontal,
  FolderInput,
  Trash2,
  Pencil,
  FileText,
  X,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Info,
  ChevronDown,
} from "lucide-react-native";
import { Image } from "../components/AppImage";
import VideoPlayer from "../components/VideoPlayer";
import AudioPreview from "../components/AudioPreview";
import DocumentPreviewCard from "../components/DocumentPreviewCard";
import PdfPreview from "../components/PdfPreview";
import TextPreview from "../components/TextPreview";
import PreviewSkeleton from "../components/PreviewSkeleton";
import ShareFolderModal from "../components/ShareFolderModal";
import { WebView } from "react-native-webview";

import apiClient, { API_BASE } from "../services/apiClient";
import { useToast } from "../context/ToastContext";
import { useDownload } from "../context/DownloadContext";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { usePreviewAssetCache } from "../hooks/usePreviewAssetCache";
import { syncAfterFileMutation } from "../services/fileStateSync";
import {
  emitFileDeleted,
  emitFileUpdated,
  useFileRefresh,
} from "../utils/events";
import {
  buildApiFileUrl,
  sanitizeDisplayName,
  sanitizeFileName,
} from "../utils/fileSafety";
import {
  buildPreviewMediaUrls,
  getCachedPreviewDetail,
  invalidatePreviewAssetCache,
  setCachedPreviewDetail,
  warmPreviewAssetUri,
} from "../utils/previewCache";

import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import * as Sharing from "expo-sharing";

// --------------------------------------------------------------------------
// Gestures & Preview Item
// --------------------------------------------------------------------------

const MIN_SCALE = 1;
const MAX_SCALE = 4;

const SPRING_CFG = { damping: 20, stiffness: 200 };
const SLOW_PREVIEW_MS = 1500;

const withRetryNonce = (url: string, nonce: number): string => {
  if (!nonce || !/^https?:\/\//i.test(url)) return url;
  return url.includes("?") ? `${url}&r=${nonce}` : `${url}?r=${nonce}`;
};

const logPreview = (event: string, meta?: Record<string, unknown>) => {
  if (__DEV__ || process.env.EXPO_PUBLIC_PREVIEW_DEBUG === "1") {
    console.info("[preview]", event, meta || {});
  }
};

type ImagePreviewItemProps = {
  item: any;
  jwt: string;
  fileSizeBytes?: number;
  isZoomed: boolean;
  isCurrent: boolean;
  onZoomChange?: (value: boolean) => void;
  onSingleTap?: () => void;
  CARD_BG: string;
  shouldLoad: boolean;
  viewportWidth: number;
  viewportHeight: number;
};

const ImagePreviewItem = React.memo(
  function ImagePreviewItem({
    item,
    jwt,
    fileSizeBytes,
    isZoomed,
    isCurrent,
    onZoomChange,
    onSingleTap,
    CARD_BG,
    shouldLoad,
    viewportWidth,
    viewportHeight,
  }: ImagePreviewItemProps) {
    const width = viewportWidth;
    const IMG_H = viewportHeight;
    const [loading, setLoading] = useState(true);
    const [useFallback, setUseFallback] = useState(false);
    const [previewFailed, setPreviewFailed] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);
    const [showSlowNotice, setShowSlowNotice] = useState(false);
    const loadStartedAtRef = useRef<number>(0);
    const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const mimeType = String(item?.mime_type || "");
    const previewWidth = mimeType.startsWith("video/") ? 720 : 480;
    const { thumbSource, activeSource } = usePreviewAssetCache({
      localUri: item.offline_uri,
      revision: item.content_revision || item.updated_at,
      baseUrl: API_BASE,
      fileId: item.id,
      jwt,
      retryNonce,
      mimeType,
      fileSizeBytes,
      isCurrent,
      shouldLoad,
      thumbWidth: previewWidth,
    });
    const imageSource = useMemo(
      () => ({
        uri: withRetryNonce(
          isCurrent && !useFallback ? activeSource.uri : thumbSource.uri,
          retryNonce,
        ),
        headers:
          isCurrent && !useFallback
            ? activeSource.headers
            : thumbSource.headers,
      }),
      [
        activeSource.headers,
        activeSource.uri,
        isCurrent,
        retryNonce,
        thumbSource.headers,
        thumbSource.uri,
        useFallback,
      ],
    );
    const placeholderSource = useMemo(
      () => ({
        uri: withRetryNonce(thumbSource.uri, retryNonce),
        headers: thumbSource.headers,
      }),
      [retryNonce, thumbSource.headers, thumbSource.uri],
    );

    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTransX = useSharedValue(0);
    const savedTransY = useSharedValue(0);
    const imageOpacity = useSharedValue(0);

    useEffect(() => {
      setLoading(true);
      setUseFallback(false);
      setPreviewFailed(false);
      setRetryNonce(0);
      setShowSlowNotice(false);
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTransX.value = 0;
      savedTransY.value = 0;
      imageOpacity.value = 0;
      loadStartedAtRef.current = Date.now();
      onZoomChange?.(false);
    }, [item?.id, isCurrent, onZoomChange]);

    useEffect(() => {
      if (!loading) {
        if (slowTimerRef.current) {
          clearTimeout(slowTimerRef.current);
          slowTimerRef.current = null;
        }
        return;
      }

      slowTimerRef.current = setTimeout(() => {
        setShowSlowNotice(true);
      }, 3500);

      return () => {
        if (slowTimerRef.current) {
          clearTimeout(slowTimerRef.current);
          slowTimerRef.current = null;
        }
      };
    }, [loading]);

    const pinch = Gesture.Pinch()
      .enabled(Platform.OS !== "web")
      .onUpdate((e) => {
        "worklet";
        scale.value = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, savedScale.value * e.scale),
        );
      })
      .onEnd(() => {
        "worklet";
        if (scale.value < 1.05) {
          scale.value = withSpring(1, SPRING_CFG);
          translateX.value = withSpring(0, SPRING_CFG);
          translateY.value = withSpring(0, SPRING_CFG);
          savedScale.value = 1;
          savedTransX.value = 0;
          savedTransY.value = 0;
        } else {
          savedScale.value = scale.value;
          const maxX = (width * (scale.value - 1)) / 2;
          const maxY = (IMG_H * (scale.value - 1)) / 2;
          const cx = Math.max(-maxX, Math.min(maxX, translateX.value));
          const cy = Math.max(-maxY, Math.min(maxY, translateY.value));
          translateX.value = cx;
          translateY.value = cy;
          savedTransX.value = cx;
          savedTransY.value = cy;
        }
        if (onZoomChange) runOnJS(onZoomChange)(scale.value > 1.05);
      });

    const pan = Gesture.Pan()
      .enabled(Platform.OS !== "web" && isZoomed)
      .averageTouches(true)
      .activeOffsetX([-10, 10])
      .activeOffsetY([-10, 10])
      .onUpdate((e) => {
        "worklet";
        if (scale.value <= 1.02) return;
        const maxX = (width * (scale.value - 1)) / 2;
        const maxY = (IMG_H * (scale.value - 1)) / 2;
        translateX.value = Math.max(
          -maxX,
          Math.min(maxX, savedTransX.value + e.translationX),
        );
        translateY.value = Math.max(
          -maxY,
          Math.min(maxY, savedTransY.value + e.translationY),
        );
      })
      .onEnd(() => {
        "worklet";
        savedTransX.value = translateX.value;
        savedTransY.value = translateY.value;
      });

    if (Platform.OS !== "web") {
      // Ensure pinch claims the stream first; pan activates only if pinch fails/ends.
      pan.requireExternalGestureToFail(pinch);
    }

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(250)
      .onEnd((e) => {
        "worklet";
        if (scale.value <= 1.02) {
          const targetScale = 2.5;
          const maxX = (width * (targetScale - 1)) / 2;
          const maxY = (IMG_H * (targetScale - 1)) / 2;
          const dx = (e.x - width / 2) * -0.35;
          const dy = (e.y - IMG_H / 2) * -0.35;
          const tx = Math.max(-maxX, Math.min(maxX, dx));
          const ty = Math.max(-maxY, Math.min(maxY, dy));
          scale.value = withSpring(targetScale, SPRING_CFG);
          translateX.value = withSpring(tx, SPRING_CFG);
          translateY.value = withSpring(ty, SPRING_CFG);
          savedScale.value = targetScale;
          savedTransX.value = tx;
          savedTransY.value = ty;
          if (onZoomChange) runOnJS(onZoomChange)(true);
          return;
        }
        scale.value = withSpring(1, SPRING_CFG);
        translateX.value = withSpring(0, SPRING_CFG);
        translateY.value = withSpring(0, SPRING_CFG);
        savedScale.value = 1;
        savedTransX.value = 0;
        savedTransY.value = 0;
        if (onZoomChange) runOnJS(onZoomChange)(false);
      });

    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .maxDuration(220)
      .onEnd(() => {
        "worklet";
        if (onSingleTap) runOnJS(onSingleTap)();
      });

    const taps = Gesture.Exclusive(doubleTap, singleTap);
    const composed =
      Platform.OS === "web" ? taps : Gesture.Simultaneous(pinch, pan, taps);

    const setZoom = (target: number) => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, target));
      scale.value = withSpring(next, SPRING_CFG);
      savedScale.value = next;
      if (next === 1) {
        translateX.value = withSpring(0, SPRING_CFG);
        translateY.value = withSpring(0, SPRING_CFG);
        savedTransX.value = 0;
        savedTransY.value = 0;
      }
      onZoomChange?.(next > 1);
    };

    const animStyle = useAnimatedStyle(() => ({
      transform: [
        { scale: scale.value as number },
        { translateX: translateX.value as number },
        { translateY: translateY.value as number },
      ] as any,
    }));

    const imageFadeStyle = useAnimatedStyle(() => ({
      opacity: imageOpacity.value,
    }));

    if (!isCurrent) {
      if (!shouldLoad) {
        return (
          <View style={styles.previewImageContainer}>
            <View
              style={[styles.previewImageArea, { backgroundColor: CARD_BG }]}
            >
              <PreviewSkeleton />
            </View>
          </View>
        );
      }

      return (
        <View style={styles.previewImageContainer}>
          <View style={[styles.previewImageArea, { backgroundColor: CARD_BG }]}>
            <Image
              source={imageSource}
              placeholder={placeholderSource}
              transition={120}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              onLoadStart={() => {
                loadStartedAtRef.current = Date.now();
                setShowSlowNotice(false);
              }}
              onLoad={() => {
                setLoading(false);
              }}
              onError={() => {
                setPreviewFailed(true);
                setLoading(false);
              }}
            />
          </View>
        </View>
      );
    }

    if (!shouldLoad) {
      return (
        <View style={styles.previewImageContainer}>
          <View style={[styles.previewImageArea, { backgroundColor: CARD_BG }]}>
            <PreviewSkeleton />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.previewImageContainer}>
        <GestureDetector gesture={composed}>
          <Animated.View
            style={[styles.previewImageArea, { backgroundColor: CARD_BG }]}
          >
            <Animated.View
              style={[
                {
                  flex: 1,
                  overflow: "hidden",
                  justifyContent: "center",
                  alignItems: "center",
                },
                animStyle,
              ]}
            >
              {/* Skeleton sits quietly in the background while expo-image handles placeholder -> source transitions */}
              {loading && (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    width: "100%",
                    height: "100%",
                    zIndex: 0,
                  }}
                >
                  <PreviewSkeleton />
                  {showSlowNotice && (
                    <View style={styles.previewSpinnerWrap}>
                      <Text style={styles.previewSlowText}>
                        Server waking up...
                      </Text>
                    </View>
                  )}
                </View>
              )}
              <Animated.View
                style={[{ width: "100%", height: "100%" }, imageFadeStyle]}
              >
                {previewFailed ? (
                  <View
                    style={{
                      flex: 1,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <ImageIcon
                      color="#F59E0B"
                      size={48}
                      style={{ marginBottom: 16 }}
                    />
                    <Text style={{ color: "#F59E0B", fontSize: 16 }}>
                      Preview unavailable
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        setPreviewFailed(false);
                        setLoading(true);
                        setUseFallback(false);
                        invalidatePreviewAssetCache(API_BASE, item.id);
                        setRetryNonce((v) => v + 1);
                        loadStartedAtRef.current = Date.now();
                      }}
                      style={styles.previewRetryBtn}
                    >
                      <Text style={styles.previewRetryText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Image
                    source={imageSource}
                    placeholder={placeholderSource}
                    transition={220}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="contain"
                    onLoadStart={() => {
                      loadStartedAtRef.current = Date.now();
                      setShowSlowNotice(false);
                      logPreview("image_load_start", {
                        fileId: item?.id,
                        usingFallback: useFallback,
                      });
                    }}
                    onLoad={() => {
                      const durationMs = Date.now() - loadStartedAtRef.current;
                      logPreview("image_load_success", {
                        fileId: item?.id,
                        durationMs,
                        slow: durationMs > SLOW_PREVIEW_MS,
                        usingFallback: useFallback,
                      });
                      setLoading(false);
                      imageOpacity.value = withTiming(1, { duration: 240 });
                    }}
                    onError={() => {
                      logPreview("image_load_error", {
                        fileId: item?.id,
                        usingFallback: useFallback,
                      });
                      if (!useFallback) {
                        setUseFallback(true);
                        setLoading(true);
                        imageOpacity.value = 0;
                        return;
                      }
                      setPreviewFailed(true);
                      setLoading(false);
                      imageOpacity.value = withTiming(1, { duration: 180 });
                    }}
                  />
                )}
              </Animated.View>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
        <View style={styles.zoomControls}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Reset zoom"
            onPress={() => setZoom(1)}
            style={styles.zoomButton}
          >
            <ZoomOut size={18} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Zoom in"
            onPress={() => setZoom(scale.value + 1)}
            style={styles.zoomButton}
          >
            <ZoomIn size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    );
  },
  (prev, next) => {
    const prevMime = String(prev.item?.mime_type || "");
    const nextMime = String(next.item?.mime_type || "");
    return (
      prev.item?.id === next.item?.id &&
      prevMime === nextMime &&
      prev.fileSizeBytes === next.fileSizeBytes &&
      prev.isZoomed === next.isZoomed &&
      prev.isCurrent === next.isCurrent &&
      prev.shouldLoad === next.shouldLoad &&
      prev.CARD_BG === next.CARD_BG &&
      prev.jwt === next.jwt
    );
  },
);

// --------------------------------------------------------------------------
// Main Screen
// --------------------------------------------------------------------------

export default function FilePreviewScreen({ route, navigation }: any) {
  const { width: screenWidth, height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [width, setPreviewWidth] = useState(screenWidth - 24);
  const [previewHeight, setPreviewHeight] = useState(
    Math.max(240, windowHeight - 220),
  );
  const { theme, isDark } = useTheme();
  const { token: jwt } = useAuth();
  const { addDownload, tasks } = useDownload();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  // Data Maps
  const routeFiles = useMemo(
    () => (Array.isArray(route?.params?.files) ? route.params.files : []),
    [route?.params?.files],
  );
  useEffect(
    () => () => {
      if (Platform.OS === "web" && route?.params?.offlineSession) {
        routeFiles.forEach((f: any) => {
          if (f.offline_uri?.startsWith("blob:"))
            URL.revokeObjectURL(f.offline_uri);
        });
      }
    },
    [routeFiles, route?.params?.offlineSession],
  );
  const allFiles = useMemo(
    () => routeFiles.filter((f: any) => f?.mime_type !== "inode/directory"),
    [routeFiles],
  );
  const fallbackFile = route?.params?.file ?? null;
  const initialIndex = Number.isInteger(route?.params?.initialIndex)
    ? route.params.initialIndex
    : 0;

  // Deep Linking support via standard hook
  const deepLinkedFileId = String(route?.params?.fileId || "").trim();
  const [deepLinkedFile, setDeepLinkedFile] = useState<any>(() =>
    getCachedPreviewDetail(deepLinkedFileId),
  );

  const previewData = useMemo(() => {
    if (allFiles.length > 0) return allFiles;
    if (fallbackFile) return [fallbackFile];
    if (deepLinkedFile) return [deepLinkedFile];
    return [];
  }, [allFiles, fallbackFile, deepLinkedFile]);

  useEffect(() => {
    if (!deepLinkedFileId || allFiles.length > 0 || fallbackFile) return;
    const cachedDetail = getCachedPreviewDetail(deepLinkedFileId);
    if (cachedDetail) {
      setDeepLinkedFile(cachedDetail);
      setIsResolvingDeepLink(false);
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    setIsResolvingDeepLink(true);

    apiClient
      .get(`/files/${deepLinkedFileId}/details`)
      .then((res) => {
        if (cancelled) return;
        const durationMs = Date.now() - startedAt;
        logPreview("file_details_success", {
          fileId: deepLinkedFileId,
          durationMs,
          slow: durationMs > SLOW_PREVIEW_MS,
        });
        const resolved = res.data?.file || res.data;
        setDeepLinkedFile(resolved);
        setCachedPreviewDetail(deepLinkedFileId, resolved);
        setIsResolvingDeepLink(false);
      })
      .catch(() => {
        if (cancelled) return;
        logPreview("file_details_error", {
          fileId: deepLinkedFileId,
          durationMs: Date.now() - startedAt,
        });
        showToast("Could not load shared file", "error");
        setIsResolvingDeepLink(false);
      });

    return () => {
      cancelled = true;
    };
  }, [allFiles.length, deepLinkedFileId, fallbackFile, showToast]);

  // Local State
  const [filesState, setFilesState] = useState<any[]>(previewData);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [isDownloadSubmitting, setIsDownloadSubmitting] = useState(false);
  const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null);
  const [isResolvingDeepLink, setIsResolvingDeepLink] = useState(
    Boolean(
      deepLinkedFileId &&
        allFiles.length === 0 &&
        !fallbackFile &&
        !getCachedPreviewDetail(deepLinkedFileId),
    ),
  );

  const [isShareModalVisible, setShareModalVisible] = useState(false);

  const [isOptionsVisible, setOptionsVisible] = useState(false);

  const [isRenameModalVisible, setRenameModalVisible] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const [isMoveModalVisible, setMoveModalVisible] = useState(false);
  const [allFolders, setAllFolders] = useState<any[]>([]);
  const [isMoving, setIsMoving] = useState(false);
  const mutationPendingRef = useRef<Set<string>>(new Set());
  const currentIndexRef = useRef(initialIndex);

  const file = filesState[currentIndex] || null;
  const refreshRevision = useRef(0);
  const refreshCurrentPreview = useCallback(() => {
    if (!file?.id || file.offline_uri || !jwt) return;
    const id = String(file.id);
    const revision = ++refreshRevision.current;
    void apiClient
      .get(`/files/${id}/details`)
      .then(({ data }) => {
        if (refreshRevision.current !== revision || !data.file) return;
        setFilesState((previous) =>
          previous.map((entry) =>
            String(entry.id) === id
              ? {
                  ...entry,
                  ...data.file,
                  file_size: Number(data.file.size),
                  size_bytes: Number(data.file.size),
                }
              : entry,
          ),
        );
      })
      .catch(() => undefined);
  }, [file?.id, file?.offline_uri, jwt]);
  useFileRefresh(refreshCurrentPreview);
  useEffect(() => {
    refreshCurrentPreview();
    return () => {
      refreshRevision.current++;
    };
  }, [refreshCurrentPreview]);

  // slide animations removed in favor of FlatList

  const beginFileMutation = useCallback((fileId?: string | null) => {
    const id = String(fileId || "").trim();
    if (!id) return false;
    if (mutationPendingRef.current.has(id)) return false;
    mutationPendingRef.current.add(id);
    return true;
  }, []);

  const endFileMutation = useCallback((fileId?: string | null) => {
    const id = String(fileId || "").trim();
    if (!id) return;
    mutationPendingRef.current.delete(id);
  }, []);

  useEffect(() => {
    if (!downloadTaskId) return;
    const task = tasks.find((t) => t.id === downloadTaskId);
    if (!task) return;
    if (task.status === "queued" || task.status === "downloading") {
      setIsDownloadSubmitting(true);
      return;
    }
    if (task.status === "completed") {
      showToast(
        task.browserHandoff
          ? "Download opened in your browser"
          : "Download completed",
      );
    } else if (task.status === "failed") {
      showToast(task.error || "Download failed", "error");
    } else if (task.status === "cancelled") {
      showToast("Download cancelled", "error");
    }
    setIsDownloadSubmitting(false);
    setDownloadTaskId(null);
  }, [downloadTaskId, tasks, showToast]);

  const uiOpacity = useSharedValue(1);
  const triggerHaptic = useCallback((ms: number = 8) => {
    if (Platform.OS === "web") return;
    Vibration.vibrate(ms);
  }, []);
  const toggleUI = useCallback(() => {
    setUiVisible((prev) => {
      const next = !prev;
      uiOpacity.value = withTiming(next ? 1 : 0, { duration: 250 });
      return next;
    });
  }, [uiOpacity]);
  const uiAnimStyle = useAnimatedStyle(() => ({ opacity: uiOpacity.value }));
  const flatListRef = useRef<FlatList>(null);
  const didInitialScrollRef = useRef(false);

  const updateCurrentFile = useCallback(
    (updater: (f: any) => any) => {
      setFilesState((prev) => {
        if (!prev[currentIndex]) return prev;
        const next = [...prev];
        next[currentIndex] = updater(next[currentIndex]);
        return next;
      });
    },
    [currentIndex],
  );

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const handleDownload = useCallback(() => {
    if (file?.offline_uri) {
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = file.offline_uri;
        a.download = sanitizeFileName(file.name || "download");
        a.click();
      } else {
        void Sharing.shareAsync(file.offline_uri, {
          mimeType: file.mime_type,
        }).catch(() => showToast("Could not export offline copy.", "error"));
      }
      return;
    }
    if (!file?.id || !jwt) {
      showToast("Missing file or session", "error");
      return;
    }
    try {
      const id = addDownload(
        file.id,
        sanitizeFileName(file.name || file.file_name || "download", "download"),
        jwt,
        file.mime_type,
      );
      setDownloadTaskId(id);
      setIsDownloadSubmitting(true);
      showToast("Download queued");
    } catch {
      setIsDownloadSubmitting(false);
      showToast("Could not start download", "error");
    }
  }, [file, jwt, addDownload, showToast]);

  const handleOpenShare = useCallback(() => {
    if (!file?.id) return;
    triggerHaptic();
    setOptionsVisible(false);
    setShareModalVisible(true);
  }, [file?.id, triggerHaptic]);

  const handleToggleStar = useCallback(async () => {
    if (!file?.id) return;
    if (!beginFileMutation(file.id)) {
      showToast("Action already in progress");
      return;
    }
    triggerHaptic();
    setOptionsVisible(false);
    try {
      const response = await apiClient.patch(`/files/${file.id}/star`);
      const nextStarState = Boolean(response?.data?.is_starred);
      updateCurrentFile((f) => ({ ...f, is_starred: nextStarState }));
      emitFileUpdated(file.id, { is_starred: nextStarState });
      showToast(
        nextStarState ? "Added to favorites" : "Removed from favorites",
      );
      syncAfterFileMutation({ clearCache: true });
    } catch {
      showToast("Could not update favorite", "error");
    } finally {
      endFileMutation(file.id);
    }
  }, [
    file?.id,
    beginFileMutation,
    endFileMutation,
    showToast,
    updateCurrentFile,
    triggerHaptic,
  ]);

  const openRenameModal = useCallback(() => {
    if (!file) return;
    triggerHaptic();
    setRenameValue(sanitizeFileName(file.name || file.file_name || "", "file"));
    setOptionsVisible(false);
    setRenameModalVisible(true);
  }, [file, triggerHaptic]);

  const handleRename = useCallback(async () => {
    const trimmed = sanitizeFileName(renameValue, "file");
    if (!file?.id || !trimmed || isRenaming) return;
    if (!beginFileMutation(file.id)) {
      showToast("Action already in progress");
      return;
    }
    setIsRenaming(true);
    try {
      await apiClient.patch(`/files/${file.id}`, {
        name: trimmed,
        file_name: trimmed,
      });
      updateCurrentFile((f) => ({ ...f, name: trimmed, file_name: trimmed }));
      emitFileUpdated(file.id, { name: trimmed, file_name: trimmed });
      setRenameModalVisible(false);
      showToast("File renamed");
      syncAfterFileMutation();
    } catch {
      showToast("Rename failed", "error");
    } finally {
      setIsRenaming(false);
      endFileMutation(file.id);
    }
  }, [
    file?.id,
    renameValue,
    isRenaming,
    beginFileMutation,
    endFileMutation,
    showToast,
    updateCurrentFile,
  ]);

  const handleDelete = useCallback(() => {
    if (!file?.id) return;
    setOptionsVisible(false);
    Alert.alert(
      "Move to Trash",
      `Move "${sanitizeDisplayName(file?.name || file?.file_name || "this file", "this file")}" to trash?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move to Trash",
          style: "destructive",
          onPress: async () => {
            if (!beginFileMutation(file.id)) {
              showToast("Action already in progress");
              return;
            }
            try {
              const indexToDelete = currentIndex;
              await apiClient.patch(`/files/${file.id}/trash`);
              setFilesState((prev) => {
                const nextFiles = prev.filter(
                  (_, idx) => idx !== indexToDelete,
                );
                const nextIndex = Math.min(
                  indexToDelete,
                  Math.max(0, nextFiles.length - 1),
                );
                setCurrentIndex(nextIndex);
                return nextFiles;
              });
              emitFileDeleted(file.id);
              showToast("Moved to trash");
              syncAfterFileMutation();
            } catch {
              showToast("Could not move to trash", "error");
            } finally {
              endFileMutation(file.id);
            }
          },
        },
      ],
    );
  }, [file, currentIndex, beginFileMutation, endFileMutation, showToast]);

  const openMoveModal = useCallback(async () => {
    if (!file?.id) return;
    triggerHaptic();
    setOptionsVisible(false);
    try {
      const res = await apiClient.get("/files/folders");
      const folders = Array.isArray(res.data)
        ? res.data
        : res.data?.folders || [];
      setAllFolders(folders);
      setMoveModalVisible(true);
    } catch {
      showToast("Could not load folders", "error");
    }
  }, [file?.id, showToast, triggerHaptic]);

  const handleMove = useCallback(
    async (targetFolderId: string | null) => {
      if (!file?.id || isMoving) return;
      if (!beginFileMutation(file.id)) {
        showToast("Action already in progress");
        return;
      }
      setIsMoving(true);
      try {
        await apiClient.post("/files/bulk", {
          ids: [file.id],
          action: "move",
          folder_id: targetFolderId,
        });
        setMoveModalVisible(false);
        emitFileUpdated(file.id, { folder_id: targetFolderId });
        showToast("File moved successfully");
        syncAfterFileMutation();
      } catch {
        showToast("Could not move file", "error");
      } finally {
        setIsMoving(false);
        endFileMutation(file.id);
      }
    },
    [file?.id, isMoving, beginFileMutation, endFileMutation, showToast],
  );

  // Design System
  const BG_COLOR = theme.colors.background;
  const CARD_BG = theme.colors.card;
  const TEXT_MAIN = theme.colors.textHeading;
  const TEXT_SUB = theme.colors.textBody;
  const ACCENT = theme.colors.primary;
  const BORDER = theme.colors.border;
  const INPUT_BG = theme.colors.inputBg;
  const DANGER = theme.colors.danger;
  const SURFACE_MUTED = theme.colors.surfaceMuted;

  const renderFileItem = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      const mime = item?.mime_type || "";
      const isCurrent = index === currentIndex;
      const shouldLoad = Math.abs(index - currentIndex) <= 1;
      let content;
      if (mime.startsWith("image/")) {
        content = (
          <ImagePreviewItem
            item={item}
            jwt={jwt}
            fileSizeBytes={Number(
              item?.file_size || item?.size_bytes || item?.size || 0,
            )}
            isZoomed={isZoomed}
            isCurrent={isCurrent}
            onZoomChange={setIsZoomed}
            onSingleTap={toggleUI}
            CARD_BG="#111827"
            shouldLoad={shouldLoad}
            viewportWidth={width}
            viewportHeight={previewHeight}
          />
        );
      } else if (mime.startsWith("video/")) {
        const { thumbUrl: videoThumbUrl } = buildPreviewMediaUrls(
          API_BASE,
          item.id,
          {
            thumbWidth: 720,
            revision: item.content_revision || item.updated_at,
          },
        );
        content = (
          <View style={[styles.previewImageContainer, { width }]}>
            <View
              style={[styles.previewImageArea, { backgroundColor: "#000" }]}
            >
              {isCurrent ? (
                <VideoPlayer
                  url={
                    item.offline_uri ||
                    buildPreviewMediaUrls(API_BASE, item.id, {
                      revision: item.content_revision || item.updated_at,
                    }).streamUrl
                  }
                  token={jwt}
                  width={width}
                  fileId={item.id}
                />
              ) : shouldLoad ? (
                <Image
                  source={{
                    uri: videoThumbUrl,
                    headers: { Authorization: `Bearer ${jwt}` },
                  }}
                  placeholder={{
                    uri: videoThumbUrl,
                    headers: { Authorization: `Bearer ${jwt}` },
                  }}
                  transition={120}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="contain"
                />
              ) : (
                <PreviewSkeleton />
              )}
            </View>
          </View>
        );
      } else if (mime.startsWith("audio/")) {
        content = (
          <AudioPreview
            url={
              item.offline_uri ||
              buildPreviewMediaUrls(API_BASE, item.id, {
                revision: item.content_revision || item.updated_at,
              }).streamUrl
            }
            token={jwt || ""}
            name={sanitizeDisplayName(item.name || item.file_name, "Audio")}
            active={isCurrent}
          />
        );
      } else if (mime.startsWith("text/") || mime === "application/json") {
        content = (
          <TextPreview
            url={
              item.offline_uri ||
              buildPreviewMediaUrls(API_BASE, item.id, {
                revision: item.content_revision || item.updated_at,
              }).streamUrl
            }
            token={jwt || ""}
            active={isCurrent}
            size={Number(item.file_size || item.size_bytes || item.size || 0)}
          />
        );
      } else if (mime === "application/pdf" && Platform.OS === "ios") {
        content = (
          <WebView
            source={{
              uri:
                item.offline_uri ||
                buildApiFileUrl(API_BASE, item.id, "download"),
              headers: { Authorization: `Bearer ${jwt}` },
            }}
            style={{ flex: 1, backgroundColor: CARD_BG }}
          />
        );
      } else if (
        mime === "application/pdf" &&
        (Platform.OS === "android" || Platform.OS === "web")
      ) {
        content = (
          <PdfPreview
            revision={item.content_revision || item.updated_at}
            offlineUri={item.offline_uri}
            baseUrl={API_BASE}
            fileId={String(item.id)}
            token={jwt || ""}
            name={sanitizeDisplayName(item.name || item.file_name, "PDF")}
            active={isCurrent}
            sizeBytes={Number(
              item.file_size || item.size_bytes || item.size || 0,
            )}
          />
        );
      } else {
        content = (
          <DocumentPreviewCard
            name={sanitizeDisplayName(item.name || item.file_name, "Document")}
            mimeType={mime}
          />
        );
      }

      return <View style={{ width, height: previewHeight }}>{content}</View>;
    },
    [
      CARD_BG,
      TEXT_MAIN,
      TEXT_SUB,
      ACCENT,
      currentIndex,
      handleDownload,
      isZoomed,
      jwt,
      toggleUI,
      width,
      previewHeight,
    ],
  );

  const keyExtractor = useCallback((item: any) => String(item.id), []);

  const formatBytes = (bytes: number) => {
    if (!bytes) return "0 B";
    const k = 1024,
      s = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + s[i];
  };

  useEffect(() => {
    setFilesState((prev) => {
      if (
        prev.length === previewData.length &&
        prev.every((entry, index) => entry?.id === previewData[index]?.id)
      ) {
        return prev;
      }
      return previewData;
    });

    setCurrentIndex((index) =>
      Math.min(index, Math.max(0, previewData.length - 1)),
    );
  }, [previewData]);

  useEffect(() => {
    if (filesState.length === 0 && !isResolvingDeepLink) {
      navigation.goBack();
      return;
    }
  }, [filesState.length, isResolvingDeepLink, navigation]);

  const hasMultipleFiles = filesState.length > 1;

  // Background preload adjacent images for instant swiping
  useEffect(() => {
    if (!jwt || filesState.length === 0) return;

    const preloadIndexes = [
      currentIndex + 1,
      currentIndex + 2,
      currentIndex - 1,
    ].filter((i) => i >= 0 && i < filesState.length);

    preloadIndexes.forEach((idx) => {
      const f = filesState[idx];
      if (f && String(f.mime_type || "").startsWith("image/")) {
        const previewWidth = Platform.OS === "web" ? 2048 : 1080;
        // Warm up the high-res view
        warmPreviewAssetUri(API_BASE, f.id, jwt, "thumbnail", {
          width: previewWidth,
          revision: f.content_revision || f.updated_at,
          mimeType: "image/webp",
        }).catch(() => {});
        // Also warm up the small thumb as fallback
        warmPreviewAssetUri(API_BASE, f.id, jwt, "thumbnail", {
          width: 480,
          revision: f.content_revision || f.updated_at,
          mimeType: "image/webp",
        }).catch(() => {});
      }
    });
  }, [currentIndex, filesState, jwt]);

  // Handle scrollIndex on initial mount with Android layout phase consideration
  const onScrollToIndexFailed = useCallback(
    (info: any) => {
      const wait = new Promise((resolve) => setTimeout(resolve, 500));
      wait.then(() => {
        const fallbackIndex = Math.max(
          0,
          Math.min(info.index, Math.max(filesState.length - 1, 0)),
        );
        flatListRef.current?.scrollToIndex({
          index: fallbackIndex,
          animated: false,
        });
      });
    },
    [filesState.length],
  );

  const onPreviewListLayout = useCallback(
    (event: any) => {
      const measuredWidth = event.nativeEvent.layout.width;
      if (measuredWidth > 0) setPreviewWidth(measuredWidth);
      const measuredHeight = event.nativeEvent.layout.height;
      if (measuredHeight > 0) setPreviewHeight(measuredHeight);
      if (didInitialScrollRef.current || filesState.length === 0) return;
      const safeIndex = Math.max(
        0,
        Math.min(initialIndex, filesState.length - 1),
      );
      didInitialScrollRef.current = true;
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToIndex({
          index: safeIndex,
          animated: false,
        });
      });
    },
    [filesState.length, initialIndex],
  );

  const getItemLayout = useCallback(
    (data: any, index: number) => ({
      length: width,
      offset: width * index,
      index,
    }),
    [width],
  );

  const onMomentumScrollEnd = useCallback(
    (e: any) => {
      const x = Number(e?.nativeEvent?.contentOffset?.x || 0);
      const clamped = Math.max(
        0,
        Math.min(filesState.length - 1, Math.round(x / width)),
      );
      const expectedOffset = clamped * width;
      const offsetDrift = Math.abs(expectedOffset - x);
      const previousIndex = currentIndexRef.current;

      if (offsetDrift > 2) {
        flatListRef.current?.scrollToIndex({
          index: clamped,
          animated: !reducedMotion,
        });
      }

      if (clamped !== previousIndex) {
        currentIndexRef.current = clamped;
        setCurrentIndex(clamped);
      }

      logPreview("swipe_resolved", {
        from: previousIndex,
        to: clamped,
        drift: offsetDrift,
      });
    },
    [filesState.length, width, reducedMotion],
  );

  const goToPreview = useCallback(
    (nextIndex: number) => {
      const next = Math.max(0, Math.min(filesState.length - 1, nextIndex));
      if (next === currentIndexRef.current) return;
      currentIndexRef.current = next;
      setIsZoomed(false);
      setCurrentIndex(next);
      flatListRef.current?.scrollToIndex({
        index: next,
        animated: !reducedMotion,
      });
    },
    [filesState.length, reducedMotion],
  );

  useEffect(() => {
    if (!filesState.length) return;
    const frame = requestAnimationFrame(() =>
      flatListRef.current?.scrollToIndex({
        index: Math.max(
          0,
          Math.min(currentIndexRef.current, filesState.length - 1),
        ),
        animated: false,
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [width, filesState.length]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const key = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (
        element?.closest("input, textarea, [contenteditable=true]") ||
        isZoomed ||
        isOptionsVisible ||
        isShareModalVisible ||
        isRenameModalVisible ||
        isMoveModalVisible
      )
        return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        goToPreview(
          currentIndexRef.current + (event.key === "ArrowRight" ? 1 : -1),
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    goToPreview,
    isZoomed,
    isOptionsVisible,
    isShareModalVisible,
    isRenameModalVisible,
    isMoveModalVisible,
  ]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: BG_COLOR, paddingTop: insets.top },
      ]}
    >
      {/* Header */}
      <Animated.View
        style={[styles.header, uiAnimStyle, { borderBottomColor: BORDER }]}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={[styles.headerBtn, { backgroundColor: SURFACE_MUTED }]}
        >
          <ArrowLeft color={TEXT_MAIN} size={22} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text
            style={[styles.headerTitle, { color: TEXT_MAIN }]}
            numberOfLines={1}
          >
            {sanitizeDisplayName(
              file?.name || file?.file_name || "File Preview",
              "File Preview",
            )}
          </Text>
          <Text style={[styles.headerSub, { color: TEXT_SUB }]}>
            {String(file?.mime_type || "").startsWith("image/")
              ? "Photo"
              : String(file?.mime_type || "").startsWith("video/")
                ? "Video"
                : "File"}
            {hasMultipleFiles
              ? ` · ${currentIndex + 1} of ${filesState.length}`
              : ""}
          </Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={file?.is_starred ? "Remove star" : "Star file"}
            style={styles.iconBtn}
            onPress={handleToggleStar}
          >
            <Star
              color={file?.is_starred ? "#F59E0B" : TEXT_MAIN}
              size={20}
              fill={file?.is_starred ? "#F59E0B" : "transparent"}
            />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="More file actions"
            style={styles.iconBtn}
            onPress={() => {
              triggerHaptic();
              setOptionsVisible(true);
            }}
          >
            <MoreHorizontal color={TEXT_MAIN} size={20} />
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Preview Area with FlatList */}
      <View
        style={[
          styles.swiperArea,
          {
            backgroundColor: String(file?.mime_type || "").match(
              /^(image|video)\//,
            )
              ? "#111827"
              : CARD_BG,
          },
        ]}
        onLayout={onPreviewListLayout}
      >
        {filesState.length > 0 && file ? (
          <FlatList
            ref={flatListRef}
            data={filesState}
            style={{ flex: 1 }}
            initialScrollIndex={Math.max(
              0,
              Math.min(initialIndex, filesState.length - 1),
            )}
            horizontal
            pagingEnabled
            disableIntervalMomentum
            decelerationRate="fast"
            snapToAlignment="start"
            snapToInterval={width}
            scrollEnabled={!isZoomed}
            showsHorizontalScrollIndicator={false}
            keyExtractor={keyExtractor}
            getItemLayout={getItemLayout}
            onScrollToIndexFailed={onScrollToIndexFailed}
            onMomentumScrollEnd={onMomentumScrollEnd}
            onScrollEndDrag={
              Platform.OS === "web" ? onMomentumScrollEnd : undefined
            }
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            removeClippedSubviews={Platform.OS !== "web"}
            renderItem={renderFileItem}
          />
        ) : (
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          >
            <ActivityIndicator size="large" color={ACCENT} />
          </View>
        )}
        {hasMultipleFiles && !isZoomed && (
          <>
            {currentIndex > 0 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Previous file"
                style={[styles.navArrow, styles.navArrowLeft]}
                onPress={() => goToPreview(currentIndex - 1)}
              >
                <ChevronLeft color="#FFFFFF" size={22} />
              </TouchableOpacity>
            )}
            {currentIndex < filesState.length - 1 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Next file"
                style={[styles.navArrow, styles.navArrowRight]}
                onPress={() => goToPreview(currentIndex + 1)}
              >
                <ChevronRight color="#FFFFFF" size={22} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* Bottom Info + Actions — in flow, not absolute */}
      <Animated.View
        style={[
          styles.bottomContainer,
          uiAnimStyle,
          {
            backgroundColor: CARD_BG,
            borderColor: BORDER,
            width: screenWidth - 24,
            maxWidth: 680,
            alignSelf: "center",
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="File details"
          accessibilityState={{ expanded: showDetails }}
          aria-expanded={showDetails}
          onPress={() => setShowDetails((v) => !v)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 18,
            paddingTop: 16,
            paddingBottom: 12,
            gap: 8,
          }}
        >
          <Info size={16} color={TEXT_SUB} />
          <Text
            style={{
              flex: 1,
              color: TEXT_SUB,
              fontFamily: "Inter_500Medium",
              fontSize: 12,
            }}
          >
            {formatBytes(file?.size ?? file?.file_size)} ·{" "}
            {file?.is_public ? "Public" : "Private"} · Original file
          </Text>
          <ChevronDown
            color={TEXT_SUB}
            size={18}
            style={{ transform: [{ rotate: showDetails ? "180deg" : "0deg" }] }}
          />
        </TouchableOpacity>
        {/* Expanded metadata stays out of the viewing area until requested. */}
        {showDetails && (
          <View style={styles.infoRow}>
            <View style={styles.infoCol}>
              <Text style={[styles.infoLabel, { color: TEXT_SUB }]}>Size</Text>
              <Text style={[styles.infoValue, { color: TEXT_MAIN }]}>
                {formatBytes(file?.size ?? file?.file_size)}
              </Text>
            </View>
            <View style={styles.infoCol}>
              <Text style={[styles.infoLabel, { color: TEXT_SUB }]}>
                Modified
              </Text>
              <Text style={[styles.infoValue, { color: TEXT_MAIN }]}>
                {file?.updated_at
                  ? new Date(file.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Unknown"}
              </Text>
            </View>
            <View style={[styles.infoCol, { alignItems: "flex-end" }]}>
              <Text style={[styles.infoLabel, { color: TEXT_SUB }]}>
                Access
              </Text>
              <Text style={[styles.infoValue, { color: TEXT_MAIN }]}>
                {file?.is_public ? "Public" : "Private"}
              </Text>
            </View>
          </View>
        )}

        {hasMultipleFiles && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              gap: 8,
              paddingHorizontal: 16,
              paddingBottom: 12,
            }}
          >
            {filesState
              .slice(
                Math.max(0, currentIndex - 2),
                Math.min(filesState.length, currentIndex + 3),
              )
              .map((entry, offset) => {
                const index = Math.max(0, currentIndex - 2) + offset;
                return (
                  <TouchableOpacity
                    key={entry.id}
                    accessibilityRole="button"
                    accessibilityLabel={"View file " + (index + 1)}
                    accessibilityState={{ selected: index === currentIndex }}
                    aria-selected={index === currentIndex}
                    onPress={() => goToPreview(index)}
                    style={{
                      padding: 3,
                      borderRadius: 17,
                      borderWidth: 2,
                      borderColor:
                        index === currentIndex ? ACCENT : "transparent",
                      backgroundColor: SURFACE_MUTED,
                    }}
                  >
                    {entry.offline_uri &&
                    String(entry.mime_type).startsWith("image/") ? (
                      <Image
                        source={{ uri: entry.offline_uri }}
                        style={{ width: 38, height: 38, borderRadius: 11 }}
                        contentFit="cover"
                      />
                    ) : (
                      <FileIcon
                        item={entry}
                        size={38}
                        token={jwt}
                        apiBase={API_BASE}
                        themeColors={theme.colors}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
          </ScrollView>
        )}

        {/* Action Bar */}
        <View style={[styles.actionBar, { borderTopColor: BORDER }]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Move file"
            style={[styles.actionBtn, { backgroundColor: SURFACE_MUTED }]}
            onPress={() => void openMoveModal()}
          >
            <FolderInput color={TEXT_MAIN} size={20} />
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Download original file"
            style={[styles.primaryActionBtn, { backgroundColor: ACCENT }]}
            onPress={handleDownload}
            disabled={isDownloadSubmitting}
          >
            {isDownloadSubmitting ? (
              <>
                <ActivityIndicator color="#FFF" size="small" />
                <Text style={styles.primaryActionText}>
                  {Math.max(
                    0,
                    Math.min(
                      99,
                      Math.round(
                        tasks.find((task) => task.id === downloadTaskId)
                          ?.progress || 0,
                      ),
                    ),
                  )}
                  % saving
                </Text>
              </>
            ) : (
              <>
                <Download color="#FFF" size={18} strokeWidth={2.5} />
                <Text style={styles.primaryActionText}>Download</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Share file"
            style={[styles.actionBtn, { backgroundColor: SURFACE_MUTED }]}
            onPress={handleOpenShare}
          >
            <Share2 color={TEXT_MAIN} size={20} />
          </TouchableOpacity>
        </View>
      </Animated.View>

      <Modal
        visible={isOptionsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setOptionsVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetOverlay}
          activeOpacity={1}
          onPress={() => setOptionsVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={{ width: "100%" }}>
            <Animated.View
              entering={FadeIn.duration(180)}
              style={[
                styles.sheetCard,
                { backgroundColor: CARD_BG, borderColor: BORDER },
              ]}
            >
              <View style={[styles.sheetHandle, { backgroundColor: BORDER }]} />
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => {
                  setOptionsVisible(false);
                  navigation.navigate("FileTools", { file });
                }}
              >
                <FolderInput color={ACCENT} size={20} />
                <Text style={[styles.optionText, { color: TEXT_MAIN }]}>
                  Offline, tags & versions
                </Text>
              </TouchableOpacity>
              <Text
                style={[styles.sheetTitle, { color: TEXT_MAIN }]}
                numberOfLines={1}
              >
                {sanitizeDisplayName(
                  file?.name || file?.file_name || "File Actions",
                  "File Actions",
                )}
              </Text>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={handleOpenShare}
              >
                <Share2 color={ACCENT} size={20} />
                <Text style={[styles.optionText, { color: TEXT_MAIN }]}>
                  Share
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={openRenameModal}
              >
                <Pencil color={TEXT_MAIN} size={20} />
                <Text style={[styles.optionText, { color: TEXT_MAIN }]}>
                  Rename
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={handleToggleStar}
              >
                <Star
                  color={file?.is_starred ? "#F59E0B" : TEXT_MAIN}
                  size={20}
                  fill={file?.is_starred ? "#F59E0B" : "transparent"}
                />
                <Text style={[styles.optionText, { color: TEXT_MAIN }]}>
                  {file?.is_starred ? "Unstar" : "Star"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => void openMoveModal()}
              >
                <FolderInput color={TEXT_MAIN} size={20} />
                <Text style={[styles.optionText, { color: TEXT_MAIN }]}>
                  Move
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.optionRow} onPress={handleDelete}>
                <Trash2 color={DANGER} size={20} />
                <Text
                  style={[
                    styles.optionText,
                    { color: DANGER, fontWeight: "700" },
                  ]}
                >
                  Delete
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={isRenameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.centeredModal}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={{ width: "100%", alignItems: "center" }}
          >
            <Animated.View
              entering={FadeIn.duration(150)}
              style={[
                styles.renameCard,
                { backgroundColor: CARD_BG, borderColor: BORDER },
              ]}
            >
              <Text style={[styles.renameTitle, { color: TEXT_MAIN }]}>
                Rename File
              </Text>
              <TextInput
                style={[
                  styles.renameInput,
                  {
                    borderColor: BORDER,
                    color: TEXT_MAIN,
                    backgroundColor: INPUT_BG,
                  },
                ]}
                value={renameValue}
                onChangeText={setRenameValue}
                autoFocus
                placeholder="Enter new name"
                placeholderTextColor={TEXT_SUB}
                onSubmitEditing={handleRename}
              />
              <View style={styles.renameActions}>
                <TouchableOpacity
                  style={[styles.renameBtn, { backgroundColor: INPUT_BG }]}
                  onPress={() => setRenameModalVisible(false)}
                >
                  <Text style={[styles.renameBtnText, { color: TEXT_MAIN }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.renameBtn, { backgroundColor: ACCENT }]}
                  onPress={handleRename}
                  disabled={
                    isRenaming || !sanitizeFileName(renameValue, "").trim()
                  }
                >
                  {isRenaming ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={[styles.renameBtnText, { color: "#FFF" }]}>
                      Rename
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </Animated.View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={isMoveModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMoveModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetOverlay}
          activeOpacity={1}
          onPress={() => setMoveModalVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={{ width: "100%" }}>
            <Animated.View
              entering={FadeIn.duration(180)}
              style={[
                styles.sheetCard,
                { backgroundColor: CARD_BG, borderColor: BORDER },
              ]}
            >
              <View style={[styles.sheetHandle, { backgroundColor: BORDER }]} />
              <Text style={[styles.sheetTitle, { color: TEXT_MAIN }]}>
                Move File To
              </Text>
              <Text style={[styles.sheetSub, { color: TEXT_SUB }]}>
                Select destination folder.
              </Text>

              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => void handleMove(null)}
                disabled={isMoving}
              >
                <FolderInput color={ACCENT} size={20} />
                <Text style={[styles.optionText, { color: TEXT_MAIN }]}>
                  Home (Root)
                </Text>
              </TouchableOpacity>
              {allFolders
                .filter((f) => String(f.id) !== String(file?.folder_id || ""))
                .map((f) => (
                  <TouchableOpacity
                    key={String(f.id)}
                    style={styles.optionRow}
                    onPress={() => void handleMove(String(f.id))}
                    disabled={isMoving}
                  >
                    <FolderInput color={TEXT_MAIN} size={20} />
                    <Text
                      style={[styles.optionText, { color: TEXT_MAIN }]}
                      numberOfLines={1}
                    >
                      {f.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              {isMoving && (
                <ActivityIndicator style={{ marginTop: 8 }} color={ACCENT} />
              )}
            </Animated.View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ShareFolderModal
        visible={isShareModalVisible}
        onClose={() => setShareModalVisible(false)}
        targetItem={file}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  /* Header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 0,
    zIndex: 10,
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  headerBtn: {
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    width: 44,
    height: 44,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconBtn: {
    padding: 8,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },

  headerCenter: { flex: 1, paddingHorizontal: 8, alignItems: "flex-start" },
  headerTitle: {
    fontWeight: "600",
    fontSize: 16,
    lineHeight: 22,
    textAlign: "left",
    fontFamily: "Inter_600SemiBold",
  },
  headerSub: {
    fontWeight: "500",
    marginTop: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },

  /* Preview Area */
  swiperArea: {
    flex: 1,
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    borderRadius: 28,
    marginHorizontal: 12,
    marginBottom: 12,
  },
  previewImageContainer: {
    width: "100%",
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  previewImageArea: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
  },
  previewSpinnerWrap: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  previewSlowText: {
    marginTop: 6,
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  previewRetryBtn: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#3B82F6",
    minHeight: 44,
    borderRadius: 12,
  },
  previewRetryText: { fontWeight: "700", color: "#FFFFFF" },

  /* Navigation Arrows */
  navArrow: {
    position: "absolute",
    top: "50%",
    marginTop: -18,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(15,23,42,0.62)",
    justifyContent: "center",
    alignItems: "center",
  },
  navArrowLeft: { left: 10 },
  navArrowRight: { right: 10 },
  zoomControls: {
    position: "absolute",
    right: 12,
    bottom: 14,
    flexDirection: "row",
    gap: 8,
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(15,23,42,0.68)",
    alignItems: "center",
    justifyContent: "center",
  },

  /* Bottom Info & Actions — in flow, not absolute */
  bottomContainer: {
    borderRadius: 28,
    borderWidth: 0,
    marginBottom: 12,
    overflow: "hidden",
    borderTopWidth: 0,
    paddingBottom: 0,
  },

  // Info Row
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
    paddingTop: 0,
    paddingBottom: 14,
  },
  infoCol: { flex: 1 },
  infoLabel: {
    fontWeight: "600",
    fontSize: 11,
    textTransform: "none",
    letterSpacing: 0,
    marginBottom: 5,
    fontFamily: "Inter_600SemiBold",
  },
  infoValue: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 20,
    fontFamily: "Inter_500Medium",
  },

  // Page dots
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
    paddingBottom: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Action Bar
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 0,
    paddingHorizontal: 14,
    paddingTop: 2,
    gap: 8,
  },
  actionBtn: {
    justifyContent: "center",
    alignItems: "center",
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  primaryActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    height: 52,
    borderRadius: 26,
    marginHorizontal: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryActionText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "600",
    marginLeft: 8,
    fontFamily: "Inter_600SemiBold",
  },

  // Shared sheets
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheetCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
    gap: 10,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 4,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sheetSub: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 2,
    fontFamily: "Inter_500Medium",
  },
  linkBox: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  linkLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  linkText: { fontSize: 13, fontWeight: "500", fontFamily: "Inter_500Medium" },
  sheetActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
  },
  sheetActionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  sheetActionText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  // Options + move
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 52,
  },
  optionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },

  // Rename modal
  centeredModal: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  renameCard: {
    width: "100%",
    borderWidth: 1,
    maxWidth: 440,
    borderRadius: 20,
    padding: 22,
  },
  renameTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
    fontFamily: "Inter_700Bold",
  },
  renameInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
    marginBottom: 14,
    fontFamily: "Inter_400Regular",
  },
  renameActions: {
    flexDirection: "row",
    gap: 10,
  },
  renameBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  renameBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
