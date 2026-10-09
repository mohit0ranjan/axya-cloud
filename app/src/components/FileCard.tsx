import React, { memo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
} from "react-native-reanimated";
import { MoreHorizontal, Star, Trash2 } from "lucide-react-native";
import { useTheme } from "../context/ThemeContext";
import { FileIcon } from "./FileIcon";
import { formatFolderMeta } from "../utils/folderMeta";
import { layout } from "../ui/layout";

interface Props {
  item: any;
  onPress: () => void;
  onOptions?: () => void;
  onStar?: () => void;
  onTrash?: () => void;
  onRestore?: () => void;
  showRestore?: boolean;
  token?: string;
  apiBase?: string;
}

const formatSize = (bytes: number) => {
  if (!bytes) return "";
  const k = 1024,
    s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + s[i];
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const FileCardComponent = ({
  item,
  onPress,
  onOptions,
  onStar,
  onTrash,
  onRestore,
  showRestore = false,
  token,
  apiBase,
}: Props) => {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, layout.animation.springSmooth);
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, layout.animation.springSmooth);
  };

  const isFolder =
    item.result_type === "folder" || item.mime_type === "inode/directory";

  return (
    <Animated.View
      style={[
        styles.wrapper,
        animatedStyle,
        { backgroundColor: theme.colors.background },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name || item.file_name || 'file'}`}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.card}
      >
        <FileIcon
          item={item}
          size={46}
          token={token}
          apiBase={apiBase}
          themeColors={theme.colors}
        />

        <View style={styles.info}>
          <Text
            style={[styles.name, { color: theme.colors.textHeading }]}
            numberOfLines={1}
          >
            {item.name || item.file_name}
          </Text>
          <Text style={[styles.meta, { color: theme.colors.textBody }]}>
            {isFolder
              ? formatFolderMeta(item)
              : [formatSize(item.size), formatDate(item.created_at)]
                  .filter(Boolean)
                  .join(" · ")}
          </Text>
        </View>

        <View style={styles.actions}>
          {showRestore && onRestore ? (
            <TouchableOpacity
              style={styles.actionBtnRestore}
              accessibilityRole="button"
              accessibilityLabel="Restore file"
              onPress={(event) => { event.stopPropagation(); onRestore(); }}
            >
              <Text
                style={[
                  styles.actionBtnRestoreText,
                  { color: theme.colors.success },
                ]}
              >
                Restore
              </Text>
            </TouchableOpacity>
          ) : null}
          {onStar ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={item?.is_starred ? 'Unstar file' : 'Star file'} style={styles.actionBtn} onPress={(event) => { event.stopPropagation(); onStar(); }}>
              <Star
                color={
                  item?.is_starred ? theme.colors.accent : theme.colors.textBody
                }
                size={18}
              />
            </TouchableOpacity>
          ) : null}
          {onTrash ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move file to trash" style={styles.actionBtnTrash} onPress={(event) => { event.stopPropagation(); onTrash(); }}>
              <Trash2 color={theme.colors.danger} size={18} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.moreBtn}
            accessibilityRole="button"
            accessibilityLabel={`Options for ${item.name || item.file_name || 'file'}`}
            onPress={(e) => {
              e.stopPropagation();
              if (onOptions) onOptions();
              else if ((item as any).onOptions) (item as any).onOptions();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MoreHorizontal color={theme.colors.textBody} size={20} />
          </TouchableOpacity>
        </View>
      </Pressable>
    </Animated.View>
  );
};

export default memo(FileCardComponent);

const styles = StyleSheet.create({
  wrapper: { marginBottom: layout.spacing.xs, borderRadius: 14 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: layout.spacing.md,
    paddingHorizontal: 12,
    minHeight: 80,
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: layout.radiusMap.md,
    justifyContent: "center",
    alignItems: "center",
  },
  info: { flex: 1, minWidth: 0, marginHorizontal: 12 },
  name: {
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 3,
    lineHeight: 22,
    fontFamily: "Inter_500Medium",
  },
  meta: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 18,
    fontFamily: "Inter_500Medium",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: layout.spacing.sm,
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: layout.radiusMap.md,
    justifyContent: "center",
    alignItems: "center",
  },
  actionBtnRestore: {
    paddingHorizontal: layout.spacing.lg,
    height: 44,
    borderRadius: layout.radiusMap.md,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: `rgba(31, 212, 90, 0.1)`,
  },
  actionBtnRestoreText: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  actionBtnTrash: {
    width: 44,
    height: 44,
    borderRadius: layout.radiusMap.md,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: `rgba(239, 68, 68, 0.08)`,
  },
  moreBtn: {
    padding: layout.spacing.sm,
    justifyContent: "center",
    alignItems: "center",
    width: 44,
    height: 44,
  },
});
