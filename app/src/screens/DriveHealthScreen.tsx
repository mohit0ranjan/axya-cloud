import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { PlatformAlert } from "../utils/alert";
import apiClient from "../services/apiClient";
import { syncAfterFileMutation } from "../services/fileStateSync";

const bytes = (n: number) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)} GB`
    : n >= 1024 ** 2
      ? `${(n / 1024 ** 2).toFixed(1)} MB`
      : `${Math.round(n / 1024)} KB`;

export default function DriveHealthScreen({ navigation }: any) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [tab, setTab] = useState<"health" | "duplicates" | "activity">(
    "health",
  );
  const [health, setHealth] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const request = useRef(0);
  const busyRef = useRef(false);
  const load = useCallback(async () => {
    const generation = ++request.current;
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      apiClient.get("/files/health"),
      apiClient.get(`/files/duplicates?page=${page}`),
      apiClient.get("/files/activity?limit=20"),
    ]);
    if (generation !== request.current) return;
    if (results[0].status === "fulfilled")
      setHealth(results[0].value.data.health);
    if (results[1].status === "fulfilled") {
      setGroups(results[1].value.data.groups || []);
      setHasMore(!!results[1].value.data.hasMore);
    }
    if (results[2].status === "fulfilled")
      setActivity(results[2].value.data.activity || []);
    if (results.some((r) => r.status === "rejected"))
      setError("Some information could not be refreshed. Pull down to retry.");
    setLoading(false);
  }, [page]);
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  const check = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("check");
    try {
      const { data } = await apiClient.post(
        "/files/sync",
        { limit: 100 },
        { timeout: 120000 },
      );
      showToast(
        `Checked ${data.checked} files · ${data.missing + data.stale} need attention`,
        data.missing + data.stale ? "info" : "success",
      );
      await load();
      syncAfterFileMutation();
    } catch (e: any) {
      showToast(
        e?.response?.data?.message ||
          e?.response?.data?.error ||
          "Telegram could not be checked. Try again.",
        "error",
      );
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  };
  const trashCopy = (file: any) =>
    PlatformAlert.alert(
      "Move this copy to trash?",
      "The other copy stays in your drive. You can restore this one from Trash.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move to trash",
          style: "destructive",
          onPress: async () => {
            if (busyRef.current) return;
            busyRef.current = true;
            setBusy(file.id);
            try {
              await apiClient.patch(`/files/${file.id}/trash`);
              syncAfterFileMutation();
              await load();
            } catch {
              showToast("Could not move this copy to trash.", "error");
            } finally {
              busyRef.current = false;
              setBusy("");
            }
          },
        },
      ],
    );
  const card = [s.card, { backgroundColor: c.card, borderColor: c.border }];
  const heading = { color: c.textHeading, fontFamily: "Inter_600SemiBold" };
  const body = { color: c.textBody, fontFamily: "Inter_400Regular" };
  return (
    <View
      style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}
    >
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={s.icon}
        >
          <ArrowLeft color={c.textHeading} size={24} />
        </Pressable>
        <Text style={[s.title, heading]}>Drive health</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh drive health"
          onPress={load}
          style={s.icon}
        >
          <RefreshCw color={c.primary} size={21} />
        </Pressable>
      </View>
      <View style={s.tabs}>
        {(["health", "duplicates", "activity"] as const).map((t) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            onPress={() => setTab(t)}
            style={[
              s.tab,
              { backgroundColor: tab === t ? c.primaryLight : c.surfaceMuted },
            ]}
          >
            <Text
              style={[s.tabText, { color: tab === t ? c.primary : c.textBody }]}
            >
              {t === "health"
                ? "Overview"
                : t === "duplicates"
                  ? "Duplicates"
                  : "Activity"}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + 28 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={c.primary}
          />
        }
      >
        {!!error && (
          <View style={[card, { borderColor: c.accent }]}>
            <Text style={body}>{error}</Text>
          </View>
        )}
        {loading && !health && (
          <ActivityIndicator color={c.primary} style={{ margin: 32 }} />
        )}
        {tab === "health" && health && (
          <>
            <View style={card}>
              <View style={s.row}>
                <View style={[s.badge, { backgroundColor: c.primaryLight }]}>
                  <ShieldCheck size={28} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.sectionTitle, heading]}>
                    Your files, checked
                  </Text>
                  <Text style={[s.copy, body]}>
                    Checks Telegram messages without deleting your file entries.
                  </Text>
                </View>
              </View>
              <View style={s.metrics}>
                {[
                  ["Files", health.total],
                  ["Checked OK", health.healthy],
                  ["Need review", health.attention],
                ].map(([label, value]) => (
                  <View key={String(label)} style={{ flex: 1 }}>
                    <Text style={[s.number, heading]}>{value}</Text>
                    <Text style={[s.small, body]}>{label}</Text>
                  </View>
                ))}
              </View>
              <Text style={[s.copy, body]}>
                {health.unchecked} files haven’t been checked yet.
              </Text>
              <Text style={[s.small, body]}>
                Last check:{" "}
                {health.latest_check
                  ? new Date(health.latest_check).toLocaleString()
                  : "Not checked yet"}
              </Text>
              <Pressable
                disabled={!!busy}
                accessibilityRole="button"
                onPress={check}
                style={[
                  s.button,
                  { backgroundColor: c.primary, opacity: busy ? 0.6 : 1 },
                ]}
              >
                {busy === "check" ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <RefreshCw color="#fff" size={18} />
                )}
                <Text style={s.buttonText}>
                  {busy === "check"
                    ? "Checking Telegram…"
                    : "Check next 100 files"}
                </Text>
              </Pressable>
              <Text style={[s.small, body]}>
                Results show the most recent check. Telegram availability can
                change.
              </Text>
            </View>
            <Pressable
              style={[card, s.row]}
              accessibilityRole="button"
              onPress={() => setTab("duplicates")}
            >
              <Copy color={c.primary} size={24} />
              <View style={{ flex: 1 }}>
                <Text style={[s.sectionTitle, heading]}>
                  Find duplicate copies
                </Text>
                <Text style={[s.copy, body]}>
                  Matches verified file contents, even with different names.
                </Text>
              </View>
              <ChevronRight color={c.muted} size={20} />
            </Pressable>
            <Pressable
              style={[card, s.row]}
              accessibilityRole="button"
              onPress={() => navigation.navigate("UploadManager")}
            >
              <Text style={[s.sectionTitle, heading, { flex: 1 }]}>
                Open transfers
              </Text>
              <ChevronRight color={c.muted} size={20} />
            </Pressable>
          </>
        )}
        {tab === "duplicates" && (
          <>
            <Text style={[s.copy, body]}>
              Review copies before removing them. Duplicate entries may share
              Telegram storage, so removing a copy may not free bytes.
            </Text>
            {!loading && !groups.length && !error && (
              <View style={card}>
                <Text style={[s.sectionTitle, heading]}>
                  No verified duplicates
                </Text>
                <Text style={[s.copy, body]}>
                  New uploads are checked using SHA-256.
                </Text>
              </View>
            )}
            {groups.map((group) => (
              <View key={group.hash} style={card}>
                <Text style={[s.sectionTitle, heading]}>
                  {group.copies} copies · {bytes(group.size)} each
                </Text>
                {group.files.map((file: any, index: number) => (
                  <View
                    key={file.id}
                    style={[s.file, { borderColor: c.border }]}
                  >
                    <Pressable
                      style={{ flex: 1 }}
                      accessibilityRole="button"
                      onPress={() =>
                        navigation.navigate("FilePreview", {
                          files: group.files,
                          initialIndex: index,
                        })
                      }
                    >
                      <Text numberOfLines={2} style={[s.filename, heading]}>
                        {file.name || file.file_name}
                      </Text>
                      <Text style={[s.small, body]}>
                        {index === 0 ? "Oldest copy" : "Duplicate copy"} · Tap
                        to preview
                      </Text>
                    </Pressable>
                    {index > 0 && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${file.name || file.file_name} to trash`}
                        disabled={!!busy}
                        onPress={() => trashCopy(file)}
                        style={s.icon}
                      >
                        {busy === file.id ? (
                          <ActivityIndicator color={c.primary} />
                        ) : (
                          <Trash2 color={c.danger} size={20} />
                        )}
                      </Pressable>
                    )}
                  </View>
                ))}
                {group.copies > group.files.length && (
                  <Text style={[s.small, body]}>
                    Showing the first {group.files.length} copies. More appear
                    as copies are removed.
                  </Text>
                )}
              </View>
            ))}
            <View style={s.row}>
              <Pressable
                disabled={page === 0 || loading}
                onPress={() => setPage((p) => p - 1)}
                style={[s.tab, { opacity: page === 0 ? 0.4 : 1 }]}
              >
                <Text style={heading}>Previous</Text>
              </Pressable>
              <Text style={body}>Page {page + 1}</Text>
              <Pressable
                disabled={!hasMore || loading}
                onPress={() => setPage((p) => p + 1)}
                style={[s.tab, { opacity: hasMore ? 1 : 0.4 }]}
              >
                <Text style={heading}>Next</Text>
              </Pressable>
            </View>
          </>
        )}
        {tab === "activity" && (
          <View style={card}>
            <Text style={[s.sectionTitle, heading]}>Recent activity</Text>
            {!loading && !activity.length && !error && (
              <Text style={[s.copy, body]}>
                Your file changes will appear here.
              </Text>
            )}
            {activity.map((item) => (
              <View key={item.id} style={[s.file, { borderColor: c.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.filename, heading]}>
                    {String(item.action).replace(/_/g, " ")}
                  </Text>
                  <Text style={[s.copy, body]} numberOfLines={2}>
                    {item.file_name || item.meta?.name || "Drive updated"}
                  </Text>
                  <Text style={[s.small, body]}>
                    {new Date(item.created_at).toLocaleString()}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  icon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
  },
  title: { fontSize: 24, flex: 1 },
  tabs: { flexDirection: "row", gap: 8, padding: 16 },
  tab: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderRadius: 24,
    alignItems: "center",
  },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  content: {
    padding: 16,
    gap: 16,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  card: { borderWidth: 0, borderRadius: 28, padding: 22, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  badge: { padding: 16, borderRadius: 20 },
  sectionTitle: { fontSize: 17 },
  copy: { fontSize: 14, lineHeight: 21 },
  small: { fontSize: 12, lineHeight: 18 },
  metrics: { flexDirection: "row", gap: 12, paddingVertical: 12 },
  number: { fontSize: 26 },
  button: {
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 10,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  buttonText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  file: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderTopWidth: 1,
    gap: 8,
  },
  filename: { fontSize: 14, lineHeight: 20 },
});
