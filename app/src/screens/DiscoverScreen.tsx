import React, { useState, useRef, useEffect } from "react";
import { ActivityIndicator, View, Text, Pressable } from "react-native";
import {
  Search,
  SlidersHorizontal,
  HardDrive,
  Clock3,
  Image,
  Film,
  Music,
  FileText,
  Files,
  X,
} from "lucide-react-native";
import { ToolInput, ToolPage, ToolRow } from "../components/DriveToolLayout";
import { LibraryShortcut } from "../components/LibraryUI";
import { EmptyState } from "../ui/EmptyState";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import apiClient from "../services/apiClient";
import { formatSize } from "../utils/format";
const categories = [
  { key: "all", title: "All", Icon: Files },
  { key: "image", title: "Photos", Icon: Image },
  { key: "video", title: "Videos", Icon: Film },
  { key: "audio", title: "Audio", Icon: Music },
  { key: "document", title: "Docs", Icon: FileText },
];
export default function DiscoverScreen({ navigation, route }: any) {
  const requestedType = categories.some((c) => c.key === route?.params?.type)
    ? route.params.type
    : "all";
  const { theme, isDark } = useTheme();
  const c = theme.colors;
  const { showToast } = useToast();
  const activeFilters = useRef<any>(null),
    busyRef = useRef(false),
    generation = useRef(0);
  const [query, setQuery] = useState(""),
    [tag, setTag] = useState(""),
    [type, setType] = useState(requestedType),
    [minimum, setMinimum] = useState(""),
    [after, setAfter] = useState("");
  const [files, setFiles] = useState<any[]>([]),
    [page, setPage] = useState(0),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false),
    [error, setError] = useState(""),
    [showFilters, setShowFilters] = useState(false);
  const search = async (next = 0, overrides: any = {}) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const current = ++generation.current;
    try {
      if (minimum && (!Number.isFinite(Number(minimum)) || Number(minimum) < 0))
        throw Error("Enter a valid size in MB.");
      if (
        after &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(after) || Number.isNaN(Date.parse(after)))
      )
        throw Error("Use YYYY-MM-DD for the date.");
      const filters =
        next && activeFilters.current
          ? activeFilters.current
          : {
              q: query.trim(),
              type,
              tag: tag.trim() || undefined,
              minBytes: minimum
                ? Math.round(Number(minimum) * 1024 ** 2)
                : undefined,
              after: after
                ? new Date(after + "T00:00:00Z").toISOString()
                : undefined,
              ...overrides,
            };
      const { data } = await apiClient.get("/files/discover", {
        params: { ...filters, page: next },
      });
      if (current !== generation.current) return;
      activeFilters.current = filters;
      const rows = Array.isArray(data.files) ? data.files : [];
      setFiles((old) =>
        next
          ? [
              ...old,
              ...rows.filter((f: any) => !old.some((o) => o.id === f.id)),
            ]
          : rows,
      );
      setMore(!!data.hasMore);
      setPage(next);
      setSearched(true);
    } catch (e: any) {
      if (current !== generation.current) return;
      const message =
        e.response?.data?.message ||
        e.message ||
        "Could not search. Try again.";
      setError(message);
      showToast(message, "error");
    } finally {
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    busyRef.current = false;
    setType(requestedType);
    void search(0, { type: requestedType });
    return () => {
      generation.current++;
    };
  }, [requestedType]);
  const filtersCount = [tag, minimum, after].filter(Boolean).length;
  return (
    <ToolPage
      title="Discover"
      subtitle="A faster way to find what you need."
      navigation={navigation}
    >
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <LibraryShortcut
          title="Large files"
          detail="100 MB and above"
          icon={HardDrive}
          tone="violet"
          onPress={() => {
            setMinimum("100");
            void search(0, { minBytes: 100 * 1024 ** 2 });
          }}
        />
        <LibraryShortcut
          title="This week"
          detail="Recently added"
          icon={Clock3}
          tone="mint"
          onPress={() => {
            setAfter("");
            void search(0, {
              after: new Date(Date.now() - 7 * 86400000).toISOString(),
            });
          }}
        />
      </View>
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}
      >
        {categories.map(({ key, title, Icon }) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: type === key }}
            aria-selected={type === key}
            disabled={busy}
            onPress={() => {
              setType(key);
              void search(0, { type: key });
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              minHeight: 44,
              paddingHorizontal: 14,
              borderRadius: 24,
              backgroundColor: type === key ? c.primary : c.card,
            }}
          >
            <Icon size={16} color={type === key ? "#FFF" : c.textHeading} />
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Inter_600SemiBold",
                color: type === key ? "#FFF" : c.textHeading,
              }}
            >
              {title}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <ToolInput
            accessibilityLabel="Search file names"
            placeholder="Search your files"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={() => void search()}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search"
          disabled={busy}
          onPress={() => void search()}
          style={{
            height: 54,
            width: 54,
            borderRadius: 27,
            backgroundColor: c.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {busy ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Search color="#FFF" size={22} />
          )}
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showFilters }}
        aria-expanded={showFilters}
        onPress={() => setShowFilters((v) => !v)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
        }}
      >
        <SlidersHorizontal size={17} color={c.primary} />
        <Text
          style={{
            color: c.primary,
            fontSize: 13,
            fontFamily: "Inter_600SemiBold",
          }}
        >
          Filters{filtersCount ? " · " + filtersCount : ""}
        </Text>
      </Pressable>
      {showFilters && (
        <View
          style={{
            backgroundColor: c.card,
            padding: 16,
            borderRadius: 24,
            gap: 12,
          }}
        >
          <Text
            style={{ color: c.textHeading, fontFamily: "Inter_600SemiBold" }}
          >
            Narrow your search
          </Text>
          <ToolInput
            accessibilityLabel="Tag"
            placeholder="Tag"
            value={tag}
            onChangeText={setTag}
            autoCapitalize="none"
          />
          <ToolInput
            accessibilityLabel="Minimum size in MB"
            placeholder="Minimum size in MB"
            keyboardType="decimal-pad"
            value={minimum}
            onChangeText={setMinimum}
          />
          <ToolInput
            accessibilityLabel="Uploaded after"
            placeholder="Uploaded after YYYY-MM-DD"
            value={after}
            onChangeText={setAfter}
          />
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setTag("");
                setMinimum("");
                setAfter("");
                void search(0, {
                  tag: undefined,
                  minBytes: undefined,
                  after: undefined,
                });
              }}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: c.textBody }}>Clear filters</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setShowFilters(false);
                void search();
              }}
              style={{
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: 12,
              }}
            >
              <Text
                style={{ color: c.primary, fontFamily: "Inter_600SemiBold" }}
              >
                Apply filters
              </Text>
            </Pressable>
          </View>
        </View>
      )}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <Text
          style={{
            color: c.textHeading,
            fontFamily: "Inter_700Bold",
            fontSize: 17,
          }}
        >
          Your files
        </Text>
        <Text style={{ color: isDark ? "#A5B0C5" : "#65748B", fontSize: 12 }}>
          {files.length}
          {more ? " +" : ""} result{files.length === 1 && !more ? "" : "s"}
        </Text>
      </View>
      {!!error && (
        <ToolRow
          title="Search unavailable"
          detail={error + " Tap to retry."}
          onPress={() => void search()}
        />
      )}
      {searched && !busy && !error && !files.length && (
        <EmptyState
          title="No matching files"
          description="Try a different name or clear your filters."
          iconType="search"
        />
      )}
      {files.map((f, i) => (
        <ToolRow
          key={f.id}
          title={f.name}
          detail={
            formatSize(Number(f.size || f.file_size || 0)) +
            " · " +
            new Date(f.created_at).toLocaleDateString()
          }
          onPress={() =>
            navigation.navigate("FilePreview", { files, initialIndex: i })
          }
        />
      ))}
      {more && (
        <ToolRow
          title="Load more files"
          disabled={busy}
          onPress={() => void search(page + 1)}
        />
      )}
    </ToolPage>
  );
}
