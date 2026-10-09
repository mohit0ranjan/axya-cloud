import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  SectionList,
} from "react-native";
import { ArrowLeft, RotateCcw, Trash2, CloudUpload } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUpload } from "../context/UploadContext";
import { uploadManager } from "../services/UploadManager";
import UploadProgress from "../components/UploadProgress";
import { useTheme } from "../context/ThemeContext";
import { PlatformAlert as Alert } from "../utils/alert";

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 0,
      borderBottomColor: theme.colors.border,
      paddingHorizontal: 20,
      paddingVertical: 18,
      minHeight: 72,
    },
    iconBtn: {
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      width: 44,
      height: 44,

      backgroundColor: theme.colors.card,
    },
    headerCenter: {
      flex: 1,
      marginLeft: 10,
    },
    headerTitle: {
      fontWeight: "700",
      color: theme.colors.textHeading,
      fontSize: 22,
      letterSpacing: -0.5,
      fontFamily: "Inter_700Bold",
    },
    headerSub: {
      marginTop: 2,
      fontSize: 12,
      fontWeight: "500",
      color: theme.colors.textBody,
      fontFamily: "Inter_500Medium",
    },
    statsCard: {
      marginHorizontal: 20,
      marginTop: 14,
      borderWidth: 0,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.primaryLight,
      borderRadius: 28,
      padding: 20,
    },
    statsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    statsLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.textBody,
      textTransform: "uppercase",
      fontFamily: "Inter_600SemiBold",
    },
    statsValue: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.textHeading,
      fontFamily: "Inter_700Bold",
    },
    progressTrack: {
      height: 7,
      borderRadius: 999,
      overflow: "hidden",
      backgroundColor: theme.colors.border,
      marginTop: 6,
    },
    progressFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: theme.colors.primary,
    },
    actionsRow: {
      flexDirection: "row",
      marginHorizontal: 20,
      marginTop: 12,
      marginBottom: 6,
      flexWrap: "wrap",
      gap: 8,
    },
    actionBtn: {
      flexGrow: 1,
      flexBasis: 125,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: 24,
    },
    actionBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.textHeading,
      fontFamily: "Inter_700Bold",
    },
    sectionWrap: {
      flex: 1,
      marginTop: 8,
    },
    sectionTitle: {
      marginHorizontal: 20,
      marginBottom: 8,
      marginTop: 10,
      color: theme.colors.textBody,
      fontWeight: "700",
      fontSize: 16,
      textTransform: "none",
      fontFamily: "Inter_700Bold",
    },
    list: { paddingHorizontal: 20, paddingBottom: 40 },
    emptyWrap: {
      marginHorizontal: 20,
      marginTop: 20,
      padding: 30,
      borderRadius: 28,
      borderWidth: 0,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyTxt: {
      color: theme.colors.textBody,
      fontWeight: "500",
      marginTop: 12,
      fontSize: 15,
      lineHeight: 23,
      fontFamily: "Inter_500Medium",
    },
  });

export default function UploadManagerScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);

  const {
    tasks,
    totalFiles,
    uploadedCount,
    failedCount,
    queuedCount,
    uploadingCount,
    overallProgress,
    uploadedBytes,
    totalBytes,
    cancelUpload,
    pauseUpload,
    resumeUpload,
    retryFailed,
    clearCompleted,
    cancelAll,
  } = useUpload();

  const activeTasks = useMemo(
    () =>
      tasks.filter((t) =>
        [
          "preparing",
          "queued",
          "uploading",
          "processing",
          "retrying",
          "waiting_retry",
          "paused",
        ].includes(t.status),
      ),
    [tasks],
  );
  const failedTasks = useMemo(
    () => tasks.filter((t) => t.status === "failed"),
    [tasks],
  );
  const completedTasks = useMemo(
    () => tasks.filter((t) => t.status === "completed"),
    [tasks],
  );
  const cancelledTasks = useMemo(
    () => tasks.filter((t) => t.status === "cancelled"),
    [tasks],
  );

  const hasAny =
    activeTasks.length > 0 ||
    failedTasks.length > 0 ||
    completedTasks.length > 0 ||
    cancelledTasks.length > 0;
  const sections = useMemo(
    () =>
      [
        { title: "Active uploads", data: activeTasks },
        { title: "Failed uploads", data: failedTasks },
        { title: "Completed uploads", data: completedTasks },
        { title: "Cancelled uploads", data: cancelledTasks },
      ].filter((section) => section.data.length > 0),
    [activeTasks, failedTasks, completedTasks, cancelledTasks],
  );
  const safeOverallProgress = useMemo(() => {
    const value = Number(overallProgress);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(Math.round(value), 100));
  }, [overallProgress]);

  const uploadOrdinalText = useMemo(() => {
    if (totalFiles <= 0) return "No active batch";
    if (uploadingCount <= 0)
      return `Uploaded ${uploadedCount} of ${totalFiles} files`;
    const current = Math.max(1, Math.min(totalFiles, uploadedCount + 1));
    return `Uploading ${current} of ${totalFiles} files`;
  }, [totalFiles, uploadingCount, uploadedCount]);

  return (
    <SafeAreaView style={[s.root, { paddingTop: Math.max(insets.top, 0) }]}>
      <View style={s.header}>
        <TouchableOpacity
          style={s.iconBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={22} color={theme.colors.textHeading} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Upload Manager</Text>
          <Text style={s.headerSub} numberOfLines={1}>
            {uploadOrdinalText} • {uploadingCount} active • {queuedCount} queued
          </Text>
        </View>
      </View>

      {hasAny && (
        <View style={s.statsCard}>
          <View style={s.statsRow}>
            <Text style={s.statsLabel}>Overall progress</Text>
            <Text style={s.statsValue}>{safeOverallProgress}%</Text>
          </View>
          <View style={s.progressTrack}>
            <View
              style={[s.progressFill, { width: `${safeOverallProgress}%` }]}
            />
          </View>
          <View style={[s.statsRow, { marginTop: 10, marginBottom: 0 }]}>
            <Text style={s.statsValue}>
              {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
            </Text>
            <Text style={s.statsValue}>
              {uploadedCount} done • {failedCount} failed
            </Text>
          </View>
        </View>
      )}

      {hasAny && (
        <View style={s.actionsRow}>
          {failedTasks.length > 0 && (
            <TouchableOpacity
              style={s.actionBtn}
              onPress={retryFailed}
              accessibilityRole="button"
              accessibilityLabel="Retry failed uploads"
            >
              <RotateCcw size={16} color={theme.colors.primary} />
              <Text style={s.actionBtnText}>Retry failed</Text>
            </TouchableOpacity>
          )}
          {(completedTasks.length > 0 || cancelledTasks.length > 0) && (
            <TouchableOpacity
              style={s.actionBtn}
              onPress={clearCompleted}
              accessibilityRole="button"
              accessibilityLabel="Clear finished uploads"
            >
              <Trash2 size={16} color={theme.colors.textBody} />
              <Text style={s.actionBtnText}>Clear finished</Text>
            </TouchableOpacity>
          )}
          {activeTasks.length > 0 && (
            <TouchableOpacity
              style={s.actionBtn}
              onPress={() =>
                Alert.alert(
                  "Cancel uploads",
                  `Cancel ${activeTasks.length} active or paused upload${activeTasks.length === 1 ? "" : "s"}?`,
                  [
                    { text: "Keep uploading", style: "cancel" },
                    {
                      text: "Cancel uploads",
                      style: "destructive",
                      onPress: cancelAll,
                    },
                  ],
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Cancel all active uploads"
            >
              <Text style={[s.actionBtnText, { color: theme.colors.danger }]}>
                Cancel active
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={s.sectionWrap}>
        {!hasAny ? (
          <View style={s.emptyWrap}>
            <CloudUpload
              size={42}
              color={theme.colors.muted || theme.colors.border}
            />
            <Text style={s.emptyTxt}>No uploads in manager yet.</Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item: any) => String(item.id)}
            renderItem={({ item }: { item: any }) => (
              <UploadProgress
                task={item}
                onCancel={cancelUpload}
                onPause={pauseUpload}
                onResume={resumeUpload}
                onRetry={resumeUpload}
                onPrioritize={(id) => uploadManager.prioritize(id)}
              />
            )}
            renderSectionHeader={({ section }: { section: any }) => (
              <Text style={s.sectionTitle}>
                {section.title} ({section.data.length})
              </Text>
            )}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={7}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
