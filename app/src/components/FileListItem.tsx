import React, { memo, useRef, useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import {
  Folder,
  Star,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  MoreHorizontal,
} from "lucide-react-native";
import { Image } from "./AppImage";
import { lightTheme } from "../context/ThemeContext";
import { formatFolderMeta } from "../utils/folderMeta";
import { buildApiFileUrl, sanitizeDisplayName } from "../utils/fileSafety";
import { SkeletonBlock } from "../ui/Skeleton";
import { useReducedMotion } from "../hooks/useReducedMotion";

type Theme = typeof lightTheme;

export interface FileItem {
  id: string;
  name?: string;
  file_name?: string;
  mime_type?: string;
  size?: number;
  file_size?: number;
  updated_at?: string;
  created_at?: string;
  is_starred?: boolean;
  result_type?: string;
  file_count?: number;
  total_file_count?: number;
  folder_count?: number;
  blurhash?: string;
  content_revision?: string;
  offline_uri?: string;
}

interface FileListItemProps {
  item: FileItem;
  token: string | null;
  apiBaseUrl: string;
  theme: Theme;
  isDark: boolean;
  onPress: (item: FileItem, isFolder: boolean) => void;
  onOptionsPress?: (item: FileItem) => void;
  variant?: "default" | "card" | "library" | "gallery";
}

const getIconConfig = (mime: string, isDark: boolean) => {
  if (!mime)
    return {
      Icon: FileText,
      color: "#8892A4",
      bg: isDark ? "rgba(136,146,164,0.15)" : "#F1F3F9",
    };
  if (mime.includes("image"))
    return {
      Icon: ImageIcon,
      color: "#F59E0B",
      bg: isDark ? "rgba(245,158,11,0.15)" : "#FEF3C7",
    };
  if (mime.includes("video"))
    return {
      Icon: Film,
      color: "#9333EA",
      bg: isDark ? "rgba(147,51,234,0.15)" : "#F3E8FF",
    };
  if (mime.includes("audio"))
    return {
      Icon: Music,
      color: "#1FD45A",
      bg: isDark ? "rgba(31,212,90,0.15)" : "#DCFCE7",
    };
  if (mime.includes("pdf"))
    return {
      Icon: FileText,
      color: "#EF4444",
      bg: isDark ? "rgba(239,68,68,0.15)" : "#FEE2E2",
    };
  if (mime.includes("zip") || mime.includes("compress"))
    return {
      Icon: Archive,
      color: "#F97316",
      bg: isDark ? "rgba(249,115,22,0.15)" : "#FFEDD5",
    };
  return {
    Icon: FileText,
    color: "#8892A4",
    bg: isDark ? "rgba(136,146,164,0.15)" : "#F1F3F9",
  };
};

const formatSize = (bytes?: number) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + s[i];
};

const formatDate = (d?: string) => {
  if (!d) return "";
  const date = new Date(d);
  return date
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    fileRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 0,
      minHeight: 80,
      paddingVertical: 12,
    },
    fileRowCard: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: theme.colors.card,
      borderBottomWidth: 0,
      shadowColor: "transparent",
      elevation: 0,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: 8,
    },
    fileIcon: {
      width: 44,
      height: 44,
      justifyContent: "center",
      alignItems: "center",
      marginRight: 14,
    },
    fileIconCard: {
      width: 44,
      height: 44,
      marginRight: 14,
    },
    fileInfo: {
      flex: 1,
      justifyContent: "center",
      marginRight: 8,
      minWidth: 0,
    },
    fileName: {
      fontWeight: "600",
      color: theme.colors.textHeading,
      marginBottom: 4,
      fontSize: 15,
      lineHeight: 22,
      fontFamily: "Inter_600SemiBold",
    },
    fileMeta: {
      fontSize: 13,
      color: theme.colors.textBody,
      fontWeight: "500",
      lineHeight: 18,
      fontFamily: "Inter_500Medium",
    },
  });

const FileListItem = ({
  item,
  token,
  apiBaseUrl,
  theme,
  isDark,
  onPress,
  onOptionsPress,
  variant = "default",
}: FileListItemProps) => {
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const reducedMotion = useReducedMotion();

  // ── Fade-in animation ─────────────────────────────────────────────────
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: reducedMotion ? 0 : 180,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion]);

  // ── Press scale animation ─────────────────────────────────────────────
  const rowScale = useRef(new Animated.Value(1)).current;
  const handleRowPressIn = useCallback(() => {
    Animated.spring(rowScale, {
      toValue: reducedMotion ? 1 : 0.99,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [reducedMotion]);
  const handleRowPressOut = useCallback(() => {
    Animated.spring(rowScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, []);

  // ── Thumbnail error state ─────────────────────────────────────────────
  const [thumbFailed, setThumbFailed] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  useEffect(() => {
    setThumbFailed(false);
    setThumbLoaded(false);
  }, [item.id, item.content_revision, item.offline_uri, token, apiBaseUrl]);
  const handleThumbError = useCallback(() => setThumbFailed(true), []);

  // ── Options button press animation ────────────────────────────────────
  const optionsScale = useRef(new Animated.Value(1)).current;
  const handleOptionsIn = useCallback(() => {
    Animated.spring(optionsScale, {
      toValue: reducedMotion ? 1 : 0.95,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [reducedMotion]);
  const handleOptionsOut = useCallback(() => {
    Animated.spring(optionsScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, []);

  const C = {
    accent: theme.colors.accent,
  };

  const isFolder =
    item.mime_type === "inode/directory" || item.result_type === "folder";
  const cfg = isFolder
    ? { Icon: Folder, color: "#4B6EF5", bg: "transparent" }
    : getIconConfig(item.mime_type || "", isDark);
  const { Icon, color, bg } = cfg;

  const mimeType = String(item.mime_type || "").toLowerCase();
  const canShowThumb =
    !isFolder &&
    !thumbFailed &&
    (mimeType.startsWith("image/") ||
      mimeType.startsWith("video/") ||
      mimeType === "application/pdf");

  const handlePress = () => {
    onPress(item, isFolder);
  };

  // Build thumbnail source with auth headers for expo-image
  const thumbSource = React.useMemo(() => {
    if (!canShowThumb) return null;
    if (item.offline_uri && /^(data:|blob:|file:)/i.test(item.offline_uri))
      return { uri: item.offline_uri };
    if (!token || !apiBaseUrl) return null;
    return {
      uri:
        buildApiFileUrl(apiBaseUrl, item.id, "thumbnail") +
        (item.content_revision
          ? `?v=${encodeURIComponent(item.content_revision)}`
          : ""),
      headers: { Authorization: `Bearer ${token}` },
    };
  }, [
    canShowThumb,
    token,
    apiBaseUrl,
    item.id,
    item.content_revision,
    item.offline_uri,
  ]);

  if (variant === "gallery")
    return (
      <Animated.View
        style={{
          opacity: fadeAnim,
          transform: [{ scale: rowScale }],
          backgroundColor: theme.colors.card,
          borderRadius: 23,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={"Open " + (item.name || item.file_name || "file")}
          activeOpacity={0.9}
          onPress={handlePress}
          onPressIn={handleRowPressIn}
          onPressOut={handleRowPressOut}
        >
          <View
            style={{
              aspectRatio: 1.25,
              backgroundColor: bg,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
              margin: 7,
              borderRadius: 17,
            }}
          >
            {thumbSource ? (
              <>
                {!thumbLoaded && (
                  <SkeletonBlock
                    width="100%"
                    borderRadius={17}
                    style={[StyleSheet.absoluteFillObject, { height: "100%" }]}
                  />
                )}
                <Image
                  source={thumbSource}
                  placeholder={
                    item.blurhash ? { blurhash: item.blurhash } : undefined
                  }
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={reducedMotion ? 0 : 150}
                  onLoad={() => setThumbLoaded(true)}
                  onError={handleThumbError}
                />
              </>
            ) : (
              <Icon color={color} size={32} strokeWidth={1.5} />
            )}
            {item.is_starred && (
              <View
                style={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  borderRadius: 12,
                  backgroundColor: theme.colors.card,
                  padding: 5,
                }}
              >
                <Star size={12} color={C.accent} fill={C.accent} />
              </View>
            )}
          </View>
          <View
            style={{
              paddingHorizontal: 12,
              paddingTop: 5,
              paddingBottom: 13,
              paddingRight: 12,
            }}
          >
            <Text
              style={{
                color: theme.colors.textHeading,
                fontFamily: "Inter_600SemiBold",
                fontSize: 13,
                lineHeight: 19,
                minHeight: 38,
              }}
              numberOfLines={2}
            >
              {sanitizeDisplayName(item.name || item.file_name || "", "File")}
            </Text>
            <Text
              style={{
                color: theme.colors.textBody,
                fontFamily: "Inter_400Regular",
                fontSize: 10,
                lineHeight: 16,
                marginTop: 6,
                minHeight: 36,
                paddingTop: 10,
                paddingRight: 32,
              }}
              numberOfLines={1}
            >
              {formatSize(item.size ?? item.file_size)}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={
            "Options for " + (item.name || item.file_name || "file")
          }
          disabled={!onOptionsPress}
          onPress={() => onOptionsPress?.(item)}
          style={{
            position: "absolute",
            right: 4,
            bottom: 8,
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MoreHorizontal size={18} color={theme.colors.textBody} />
        </TouchableOpacity>
      </Animated.View>
    );

  return (
    <Animated.View
      style={{ opacity: fadeAnim, transform: [{ scale: rowScale }] }}
    >
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name || item.file_name || "file"}`}
        style={[
          styles.fileRow,
          variant === "card" && styles.fileRowCard,
          variant === "library" && {
            backgroundColor: theme.colors.card,
            paddingHorizontal: 16,
            paddingVertical: 16,
            borderRadius: 24,
            minHeight: 88,
            marginBottom: 10,
          },
        ]}
        activeOpacity={0.7}
        onPress={handlePress}
        onPressIn={handleRowPressIn}
        onPressOut={handleRowPressOut}
      >
        <View
          style={[
            styles.fileIcon,
            { backgroundColor: bg, overflow: "hidden" },
            !isFolder ? { borderRadius: 16 } : null,
            variant === "card" && styles.fileIconCard,
            variant === "library" && {
              width: 48,
              height: 48,
              borderRadius: 16,
              backgroundColor: isFolder ? theme.colors.primaryLight : bg,
            },
            variant === "card" && !isFolder ? { borderRadius: 16 } : null,
          ]}
        >
          {thumbSource ? (
            <Image
              source={thumbSource}
              placeholder={
                item.blurhash ? { blurhash: item.blurhash } : undefined
              }
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              cachePolicy="disk"
              transition={200}
              onError={handleThumbError}
            />
          ) : (
            <Icon
              color={color}
              size={isFolder ? 40 : 24}
              fill={isFolder ? color : "none"}
            />
          )}
        </View>
        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {sanitizeDisplayName(item.name || item.file_name || "", "File")}
          </Text>
          <Text
            style={[
              styles.fileMeta,
              variant === "library" && {
                fontSize: 12,
                color: isDark ? "#A5B0C5" : "#65748B",
              },
            ]}
            numberOfLines={1}
          >
            {isFolder
              ? formatFolderMeta(item)
              : [
                  formatSize(item.size ?? item.file_size),
                  formatDate(item.created_at),
                ]
                  .filter(Boolean)
                  .join(" • ")}
          </Text>
        </View>
        {item.is_starred && (
          <Star
            color={C.accent}
            size={14}
            fill={C.accent}
            style={{ marginRight: 8 }}
          />
        )}
        <View style={{ width: 44 }} />
      </TouchableOpacity>
      <Animated.View
        style={{
          position: "absolute",
          right: variant === "library" ? 16 : variant === "card" ? 16 : 0,
          top: "50%",
          marginTop: -22,
          transform: [{ scale: optionsScale }],
        }}
      >
        <TouchableOpacity
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              variant === "library" ? theme.colors.surfaceMuted : "transparent",
          }}
          disabled={!onOptionsPress}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={`Options for ${item.name || item.file_name || "file"}`}
          onPress={(event) => {
            event.stopPropagation();
            onOptionsPress && onOptionsPress(item);
          }}
          onPressIn={handleOptionsIn}
          onPressOut={handleOptionsOut}
        >
          <MoreHorizontal color={theme.colors.textBody} size={20} />
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
};

function arePropsEqual(
  prev: FileListItemProps,
  next: FileListItemProps,
): boolean {
  return (
    prev.item.id === next.item.id &&
    prev.item.is_starred === next.item.is_starred &&
    prev.item.name === next.item.name &&
    prev.item.file_name === next.item.file_name &&
    prev.item.size === next.item.size &&
    prev.item.file_size === next.item.file_size &&
    prev.item.offline_uri === next.item.offline_uri &&
    prev.item.mime_type === next.item.mime_type &&
    prev.item.file_count === next.item.file_count &&
    prev.item.total_file_count === next.item.total_file_count &&
    prev.item.folder_count === next.item.folder_count &&
    prev.item.blurhash === next.item.blurhash &&
    prev.item.content_revision === next.item.content_revision &&
    prev.theme === next.theme &&
    prev.isDark === next.isDark &&
    prev.token === next.token &&
    prev.variant === next.variant &&
    prev.apiBaseUrl === next.apiBaseUrl &&
    prev.onPress === next.onPress &&
    prev.onOptionsPress === next.onOptionsPress &&
    prev.item.updated_at === next.item.updated_at
  );
}

export default memo(FileListItem, arePropsEqual);
