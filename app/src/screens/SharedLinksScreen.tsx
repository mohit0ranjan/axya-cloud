import { LibraryHeader } from "../components/LibraryUI";
import { ToolInput } from "../components/DriveToolLayout";
import { SkeletonBlock } from "../ui/Skeleton";
import { PlatformAlert as Alert } from "../utils/alert";
import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import {
  ArrowLeft,
  Clock,
  Eye,
  Download,
  Link as LinkIcon,
  Trash2,
  Folder,
  File as FileIcon,
} from "lucide-react-native";
import apiClient from "../services/apiClient";
import { revokeShareLink } from "../services/api";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { ErrorState } from "../ui/ErrorState";
import {
  buildExternalShareUrl,
  normalizeExternalShareUrl,
} from "../utils/shareUrls";

function formatDistanceToNow(
  date: Date,
  opts?: { addSuffix?: boolean },
): string {
  const now = Date.now();
  const diff = Math.abs(now - date.getTime());
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);

  let result: string;
  if (seconds < 60) result = "less than a minute";
  else if (minutes < 60) result = `${minutes} minute${minutes > 1 ? "s" : ""}`;
  else if (hours < 24) result = `${hours} hour${hours > 1 ? "s" : ""}`;
  else if (days < 30) result = `${days} day${days > 1 ? "s" : ""}`;
  else result = `${months} month${months > 1 ? "s" : ""}`;

  if (opts?.addSuffix) {
    return date.getTime() < now ? `${result} ago` : `in ${result}`;
  }
  return result;
}

const createStyles = (theme: any, C: any) =>
  StyleSheet.create({
    container: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 0,
      borderBottomColor: C.border,
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 18,
      minHeight: 72,
    },
    backBtn: {
      justifyContent: "center",
      width: 44,
      height: 44,
      alignItems: "center",
      borderRadius: 22,
      backgroundColor: C.card,
    },
    headerInfo: { flex: 1 },
    title: {
      fontSize: 24,
      lineHeight: 32,
      letterSpacing: -0.6,
      fontWeight: "600",
      fontFamily: "Inter_600SemiBold",
    },
    subtitle: {
      fontSize: 12,
      marginTop: 2,
      fontWeight: "500",
      fontFamily: "Inter_500Medium",
    },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    list: { padding: 20, gap: 16, paddingBottom: 36 },
    card: {
      padding: 20,
      borderWidth: 0,
      borderColor: C.border,
      ...theme.shadows.elevation1,
      borderRadius: 28,
      shadowOpacity: 0,
      elevation: 0,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 16,
    },
    iconBox: {
      width: 48,
      height: 48,
      borderRadius: 16,
      backgroundColor: C.primaryLight,
      justifyContent: "center",
      alignItems: "center",
    },
    itemName: {
      fontWeight: "600",
      marginBottom: 2,
      fontSize: 16,
      lineHeight: 23,
      fontFamily: "Inter_600SemiBold",
    },
    itemDate: { fontSize: 13, fontFamily: "Inter_400Regular" },
    expiredBadge: {
      backgroundColor: C.danger + "22",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
    },
    expiredText: {
      color: C.danger,
      fontSize: 11,
      fontWeight: "600",
      fontFamily: "Inter_600SemiBold",
    },
    statsRow: {
      flexDirection: "row",
      gap: 16,
      marginBottom: 16,
      flexWrap: "wrap",
    },
    stat: { flexDirection: "row", alignItems: "center", gap: 6 },
    statText: {
      fontSize: 13,
      fontWeight: "500",
      fontFamily: "Inter_500Medium",
    },
    actions: { flexDirection: "row", borderTopWidth: 1, paddingTop: 16 },
    actionBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 48,
      borderRadius: 22,
    },
    actionText: {
      fontSize: 14,
      fontWeight: "600",
      fontFamily: "Inter_600SemiBold",
    },
    divider: { width: 1, height: "100%" },
    empty: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 80,
      gap: 16,
    },
    emptyText: {
      fontWeight: "600",
      fontSize: 18,
      fontFamily: "Inter_600SemiBold",
    },
    emptySub: {
      fontSize: 14,
      textAlign: "center",
      lineHeight: 22,
      fontFamily: "Inter_400Regular",
    },
  });

export default function SharedLinksScreen({ navigation }: any) {
  const { theme } = useTheme();
  const C = theme.colors;
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, C), [theme, C]);
  const { showToast } = useToast();
  const [links, setLinks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const inactive = (r: any) =>
    !!(r.revokedAt || r.revoked_at || r.is_revoked || r.status === "revoked") ||
    !!(
      (r.expiresAt || r.expires_at) &&
      new Date(r.expiresAt || r.expires_at).getTime() <= Date.now()
    );
  const visibleLinks = links.filter(
    (r) =>
      (filter === "all" ||
        (filter === "active" ? !inactive(r) : inactive(r))) &&
      [r.name, r.resourceName, r.slug, r.resourceType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );

  const fetchLinks = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const res = await apiClient.get("/api/v2/shares");
      if (res.data.success) {
        setLinks(res.data.shares || []);
      }
    } catch (e: any) {
      const message =
        e?.response?.data?.error || "Could not load shared links right now.";
      setLoadError(message);
      showToast(message, "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchLinks();
    const unsubscribe = navigation.addListener("focus", () => {
      void fetchLinks();
    });
    return unsubscribe;
  }, [navigation]);

  const handleCopy = async (shareUrl: string) => {
    await Clipboard.setStringAsync(shareUrl);
    showToast("Link copied to clipboard", "success");
  };

  const handleRevoke = (token: string) => {
    Alert.alert(
      "Revoke Link",
      "Are you sure you want to delete this shared link? Anyone with the link will lose access immediately.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            try {
              await revokeShareLink(token);
              showToast("Share link revoked", "success");
              void fetchLinks();
            } catch (e: any) {
              showToast(
                e?.response?.data?.error || "Failed to revoke link.",
                "error",
              );
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: any }) => {
    const isFolder = String(item.resourceType || "").toLowerCase() === "folder";
    const name =
      item.resourceName ||
      item.name ||
      (isFolder ? "Shared folder" : "Shared file");
    const createdAt = item.createdAt || item.created_at;
    const expiresAt = item.expiresAt || item.expires_at;
    const shareUrl = normalizeExternalShareUrl(
      String(
        item.share_url ||
          item.shareUrl ||
          buildExternalShareUrl(item.slug || "", item.secret || ""),
      ),
    ).trim();
    const canCopyShareUrl = Boolean(shareUrl && /[?&]k=/.test(shareUrl));
    const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;

    return (
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={"Manage link for " + name}
          activeOpacity={0.9}
          style={styles.cardHeader}
          onPress={() =>
            navigation.navigate("SharedLinkDetail", {
              shareId: item.id,
              initialShare: item,
            })
          }
        >
          <View style={styles.iconBox}>
            {isFolder ? (
              <Folder color={C.accent} size={20} />
            ) : (
              <FileIcon color={C.primary} size={20} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.itemName, { color: C.textHeading }]}
              numberOfLines={1}
            >
              {name}
            </Text>
            <Text style={[styles.itemDate, { color: C.textBody }]}>
              Created{" "}
              {formatDistanceToNow(new Date(createdAt || Date.now()), {
                addSuffix: true,
              })}
            </Text>
          </View>
          {isExpired && (
            <View style={styles.expiredBadge}>
              <Text style={styles.expiredText}>Expired</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Eye color={C.textBody} size={14} />
            <Text style={[styles.statText, { color: C.textBody }]}>
              {item.views || 0} views
            </Text>
          </View>
          <View style={styles.stat}>
            <Download color={C.textBody} size={14} />
            <Text style={[styles.statText, { color: C.textBody }]}>
              {item.download_count || 0} dl
            </Text>
          </View>
          {expiresAt && !isExpired && (
            <View style={styles.stat}>
              <Clock color={C.textBody} size={14} />
              <Text style={[styles.statText, { color: C.textBody }]}>
                {formatDistanceToNow(new Date(expiresAt))} left
              </Text>
            </View>
          )}
          {!!item.fileCount && (
            <View style={styles.stat}>
              <FileIcon color={C.textBody} size={14} />
              <Text style={[styles.statText, { color: C.textBody }]}>
                {item.fileCount} file{Number(item.fileCount) === 1 ? "" : "s"}
              </Text>
            </View>
          )}
        </View>

        <View style={[styles.actions, { borderTopColor: C.border }]}>
          <TouchableOpacity
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel={"Copy link for " + name}
            disabled={!canCopyShareUrl}
            onPress={(e: any) => {
              e?.stopPropagation?.();
              void handleCopy(shareUrl);
            }}
          >
            <LinkIcon color={C.primary} size={16} />
            <Text
              style={[
                styles.actionText,
                { color: canCopyShareUrl ? C.primary : C.textBody },
              ]}
            >
              {canCopyShareUrl ? "Copy Link" : "Link unavailable"}
            </Text>
          </TouchableOpacity>
          <View style={[styles.divider, { backgroundColor: C.border }]} />
          <TouchableOpacity
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel={"Revoke link for " + name}
            onPress={(e: any) => {
              e?.stopPropagation?.();
              handleRevoke(item.id);
            }}
          >
            <Trash2 color={C.danger} size={16} />
            <Text style={[styles.actionText, { color: C.danger }]}>Revoke</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLinks().finally(() => setRefreshing(false));
  }, []);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: C.background, paddingTop: insets.top },
      ]}
    >
      <LibraryHeader
        title="Shared links"
        subtitle="Share on your terms"
        onBack={() => navigation.goBack()}
      />
      <View
        style={{
          marginHorizontal: 20,
          padding: 22,
          borderRadius: 28,
          backgroundColor: C.primaryLight,
          marginBottom: 16,
        }}
      >
        <LinkIcon color={C.primary} size={25} />
        <Text
          style={{
            color: C.textHeading,
            fontFamily: "Inter_700Bold",
            fontSize: 25,
            marginTop: 10,
          }}
        >
          {links.filter((r) => !inactive(r)).length} active links
        </Text>
        <Text
          style={{
            color: theme.mode === "dark" ? "#A5B0C5" : "#65748B",
            fontSize: 12,
            lineHeight: 19,
            marginTop: 6,
          }}
        >
          Manage passwords, expiry and download access from each link’s details.
        </Text>
      </View>
      <View style={{ paddingHorizontal: 20, gap: 12, marginBottom: 6 }}>
        <ToolInput
          accessibilityLabel="Search shared links"
          placeholder="Search name or link"
          value={query}
          onChangeText={setQuery}
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {["all", "active", "inactive"].map((value) => (
            <TouchableOpacity
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === value }}
              aria-selected={filter === value}
              onPress={() => setFilter(value)}
              style={{
                paddingHorizontal: 18,
                minHeight: 44,
                justifyContent: "center",
                borderRadius: 24,
                backgroundColor: filter === value ? C.primary : C.card,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_600SemiBold",
                  color: filter === value ? "#FFF" : C.textHeading,
                }}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {isLoading && links.length === 0 ? (
        <View style={styles.center}>
          <View style={{ padding: 20 }}>
            {[1, 2, 3].map((i) => (
              <SkeletonBlock
                key={i}
                width="100%"
                height={120}
                borderRadius={28}
                style={{ marginBottom: 16 }}
              />
            ))}
          </View>
        </View>
      ) : loadError && links.length === 0 ? (
        <ErrorState
          title="Could not load shared links"
          message={loadError}
          onRetry={() => void fetchLinks()}
        />
      ) : (
        <FlatList
          data={visibleLinks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={C.primary}
              onRefresh={onRefresh}
            />
          }
          windowSize={10}
          maxToRenderPerBatch={15}
          removeClippedSubviews
          ListHeaderComponent={
            loadError && links.length > 0 ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => void fetchLinks()}
                style={{ padding: 14 }}
              >
                <Text style={{ color: C.danger }}>
                  Could not refresh links · Retry
                </Text>
              </TouchableOpacity>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <LinkIcon color={C.textBody} size={48} />
              <Text style={[styles.emptyText, { color: C.textHeading }]}>
                {query || filter !== "all"
                  ? "No matching links"
                  : "Your sharing space"}
              </Text>
              <Text style={[styles.emptySub, { color: C.textBody }]}>
                {query || filter !== "all"
                  ? "Try another search or view all links."
                  : "Files and folders you share will appear here."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
