/** Development-only visual review. No auth bootstrap, transfer managers or live API calls. */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { NavigationContext } from "@react-navigation/native";
import { AuthContext } from "../context/AuthContext";
import { UploadContext } from "../context/UploadContext";
import { DownloadContext } from "../context/DownloadContext";
import { ServerStatusContext } from "../context/ServerStatusContext";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import apiClient from "../services/apiClient";
import Home from "../screens/HomeScreen";
import { useApiCacheStore } from "../context/ApiCacheStore";
import Folders from "../screens/FoldersScreen";
import Account from "../screens/ProfileScreen";
import FolderFiles from "../screens/FolderFilesScreen";
import FilePreview from "../screens/FilePreviewScreen";
import AllFiles from "../screens/AllFilesScreen";
import Starred from "../screens/StarredScreen";
import Trash from "../screens/TrashScreen";
import SharedLinks from "../screens/SharedLinksScreen";
import SharedLinkDetail from "../screens/SharedLinkDetailScreen";
import DriveTools from "../screens/DriveToolsScreen";
import FileTools from "../screens/FileToolsScreen";
import Discover from "../screens/DiscoverScreen";
import OfflineFiles from "../screens/OfflineFilesScreen";
import FileRequests from "../screens/FileRequestsScreen";
import PhotoBackup from "../screens/PhotoBackupScreen";
import BulkOrganise from "../screens/BulkOrganiseScreen";
import Analytics from "../screens/AnalyticsScreen";
import DriveHealth from "../screens/DriveHealthScreen";
import UploadManager from "../screens/UploadManagerScreen";
const folder = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "Personal",
  file_count: 3,
  total_file_count: 3,
  folder_count: 0,
  created_at: "2026-10-09T10:00:00Z",
  updated_at: "2026-10-09T10:00:00Z",
  size: 10485760,
};
const image =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#DBEAFE"/><circle cx="650" cy="320" r="125" fill="#FCBD0B"/><path d="M0 900L300 460L900 1120V1200H0" fill="#3B82F6"/><path d="M0 1140L600 600L900 900V1200H0" fill="#2243A1"/><text x="70" y="155" font-family="sans-serif" font-size="48" fill="#18314F">A moment worth keeping.</text></svg>',
  );
const files = [
  {
    id: "design-photo",
    name: "Weekend memories.svg",
    file_name: "Weekend memories.svg",
    mime_type: "image/svg+xml",
    size: 2488320,
    file_size: 2488320,
    folder_id: folder.id,
    created_at: "2026-10-09T10:00:00Z",
    updated_at: "2026-10-09T10:00:00Z",
    offline_uri: image,
    is_starred: true,
  },
  {
    id: "design-doc",
    name: "Project notes.txt",
    file_name: "Project notes.txt",
    mime_type: "text/plain",
    size: 34816,
    file_size: 34816,
    folder_id: folder.id,
    created_at: "2026-10-08T10:00:00Z",
    updated_at: "2026-10-08T10:00:00Z",
    offline_uri:
      "data:text/plain,Project%20notes%0AKeep%20your%20files%20organised.",
  },
  {
    id: "design-photo-2",
    name: "Travel ideas.svg",
    file_name: "Travel ideas.svg",
    mime_type: "image/svg+xml",
    size: 5294080,
    file_size: 5294080,
    folder_id: folder.id,
    created_at: "2026-10-07T10:00:00Z",
    updated_at: "2026-10-07T10:00:00Z",
    offline_uri: image,
  },
];
const screens: Record<string, any> = {
  Home,
  Folders,
  Account,
  FolderFiles,
  FilePreview,
  AllFiles,
  Starred,
  Trash,
  SharedLinks,
  SharedLinkDetail,
  DriveTools,
  FileTools,
  Discover,
  OfflineFiles,
  FileRequests,
  PhotoBackup,
  BulkOrganise,
  Analytics,
  DriveHealth,
  UploadManager,
};
const shares = [
  {
    id: "00000000-0000-4000-8000-000000000020",
    slug: "weekend-memories",
    resourceName: "Weekend memories.svg",
    resourceType: "file",
    fileCount: 1,
    allowDownload: true,
    allowPreview: true,
    requiresPassword: true,
    createdAt: "2026-10-09T10:00:00Z",
    expiresAt: null,
    revokedAt: null,
    views: 4,
    download_count: 2,
    share_url: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000021",
    slug: "travel-collection",
    resourceName: "Travel",
    resourceType: "folder",
    fileCount: 6,
    allowDownload: true,
    allowPreview: true,
    requiresPassword: false,
    createdAt: "2026-10-01T10:00:00Z",
    expiresAt: "2026-10-02T10:00:00Z",
    revokedAt: null,
    views: 9,
    download_count: 3,
    share_url: null,
  },
];
export default function DesignPreview() {
  const { theme } = useTheme(),
    { showToast } = useToast();
  const [screen, setScreen] = useState("Home"),
    [params, setParams] = useState<any>({}),
    [mode, setMode] = useState("normal");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!__DEV__) return;
    const { homeData, allFiles, starredFiles, foldersList } =
      useApiCacheStore.getState();
    useApiCacheStore.getState().clearCache();
    const methods = ["get", "post", "put", "patch", "delete"] as const;
    const original: any = {};
    methods.forEach((m) => {
      original[m] = apiClient[m];
    });
    const blocked = async () => {
      throw Error(
        "Design preview: changes are disabled. Open the normal app to use your account.",
      );
    };
    methods.forEach((m) => {
      (apiClient as any)[m] = blocked;
    });
    (apiClient as any).get = async (url: string, options: any = {}) => {
      if (modeRef.current === "error")
        throw Error("Design preview: connection interrupted.");
      const empty = modeRef.current === "empty";
      const list = empty ? [] : files;
      let data: any = { success: true };
      if (url.includes("/folders"))
        data.folders =
          empty || modeRef.current === "unfiled" || url.includes("parent_id")
            ? []
            : [
                folder,
                {
                  ...folder,
                  id: "00000000-0000-4000-8000-000000000011",
                  name: "Projects",
                  file_count: 12,
                  total_file_count: 12,
                },
                {
                  ...folder,
                  id: "00000000-0000-4000-8000-000000000012",
                  name: "Documents",
                  file_count: 8,
                  total_file_count: 8,
                },
                {
                  ...folder,
                  id: "00000000-0000-4000-8000-000000000013",
                  name: "Travel",
                  file_count: 6,
                  total_file_count: 6,
                },
              ];
      else if (url.includes("/stats"))
        data = {
          success: true,
          totalBytes: empty ? 0 : 2488320 + 34816 + 5294080,
          totalFiles: list.length,
          totalFolders: empty ? 0 : 4,
          starredCount: empty ? 0 : 1,
          trashCount: 0,
          storageByType: empty
            ? []
            : [
                { category: "image", count: 2, bytes: "7782400" },
                { category: "other", count: 1, bytes: "34816" },
              ],
        };
      else if (url.includes("/tags")) data.tags = ["personal", "ideas"];
      else if (url.includes("/versions")) data.versions = [];
      else if (url.includes("/details")) data.file = files[0];
      else if (url.includes("/health"))
        data.health = {
          total: list.length,
          healthy: list.length,
          attention: 0,
        };
      else if (url.includes("/duplicates")) data.groups = [];
      else if (url.includes("/activity")) data.activity = [];
      else if (url === "/api/v2/shares") data.shares = empty ? [] : shares;
      else if (url.startsWith("/api/v2/shares/"))
        data = {
          success: true,
          share: shares.find((s) => url.endsWith(s.id)) || shares[0],
          analytics: { opens: 4, downloads: 2, previews: 3, errors: 0 },
          recentEvents: [],
        };
      else if (url.includes("/file-requests")) data.requests = [];
      else {
        const u = new URL(url, "http://preview.invalid");
        const q = String(
          options.params?.q || u.searchParams.get("q") || "",
        ).toLowerCase();
        const type = options.params?.type || u.searchParams.get("type");
        data.files = list.filter(
          (f) =>
            f.name.toLowerCase().includes(q) &&
            (!type ||
              type === "all" ||
              (type === "document"
                ? f.mime_type.startsWith("text/")
                : f.mime_type.startsWith(type + "/"))),
        );
        if (url.includes("/files/search")) data.results = data.files;
        data.total_count = data.files.length;
        data.hasMore = false;
      }
      return { data };
    };
    setReady(true);
    return () => {
      useApiCacheStore.setState({
        homeData,
        allFiles,
        starredFiles,
        foldersList,
      });
      methods.forEach((m) => {
        (apiClient as any)[m] = original[m];
      });
    };
  }, []);
  const navigate = (name: string, value: any = {}) => {
    const target =
      name === "MainTabs"
        ? value.screen === "Profile"
          ? "Account"
          : value.screen === "Home"
            ? "Home"
            : value.screen
        : name === "Profile"
          ? "Account"
          : name;
    if (screens[target]) {
      setParams(value);
      setScreen(target);
    } else showToast("Open the normal app for this action.", "info");
  };
  const navigation: any = {
    navigate,
    push: navigate,
    goBack: () => navigate("Home"),
    canGoBack: () => true,
    addListener: () => () => {},
    getParent: () => navigation,
  };
  const blocked = () =>
    showToast(
      "Sample data only. Open the normal app to upload or change files.",
      "info",
    );
  const upload: any = {
    tasks: [],
    totalFiles: 0,
    uploadedCount: 0,
    queuedCount: 0,
    failedCount: 0,
    activeCount: 0,
    uploadingCount: 0,
    pausedCount: 0,
    cancelledCount: 0,
    totalBytes: 0,
    uploadedBytes: 0,
    avgUploadSpeedBps: 0,
    currentUploadSpeedBps: 0,
    overallProgress: 0,
    addUpload: blocked,
    cancelUpload: blocked,
    cancelAll: blocked,
    pauseUpload: blocked,
    resumeUpload: blocked,
    clearCompleted: blocked,
    retryFailed: blocked,
  };
  const download: any = {
    tasks: [],
    addDownload: () => {
      blocked();
      return "preview";
    },
    cancelDownload: blocked,
    cancelAll: blocked,
    clearCompleted: blocked,
    activeCount: 0,
    overallProgress: 0,
    hasActive: false,
  };
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Mohit",
    phone: "Telegram account",
  };
  const Component = screens[screen];
  const route = {
    params: {
      folderId: folder.id,
      folderName: folder.name,
      file: files[0],
      files,
      initialIndex: 0,
      offlineSession: true,
      shareId: shares[0].id,
      ...params,
    },
  };
  return (
    <ServerStatusContext.Provider
      value={{
        isWaking: false,
        statusText: "",
        wakeTimedOut: false,
        retryWake: blocked,
      }}
    >
      <AuthContext.Provider
        value={{
          user,
          token: null,
          isAuthenticated: true,
          isLoading: false,
          setUser: () => {},
          login: async () => {},
          logout: async () => {
            blocked();
          },
        }}
      >
        <UploadContext.Provider value={upload}>
          <DownloadContext.Provider value={download}>
            <NavigationContext.Provider value={navigation}>
              <View
                style={{ flex: 1, backgroundColor: theme.colors.background }}
              >
                <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
                  <Text style={{ color: theme.colors.textBody, fontSize: 10 }}>
                    DESIGN PREVIEW · SAMPLE DATA · NO LIVE TRANSFERS
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  style={{ flexGrow: 0, maxHeight: 46 }}
                  contentContainerStyle={{
                    gap: 8,
                    paddingHorizontal: 16,
                    paddingVertical: 6,
                  }}
                  showsHorizontalScrollIndicator={false}
                >
                  {[
                    "Home",
                    "Folders",
                    "Account",
                    "FilePreview",
                    "AllFiles",
                    "DriveTools",
                    "Discover",
                    "SharedLinks",
                    "SharedLinkDetail",
                    "Trash",
                    "DriveHealth",
                    "UploadManager",
                  ].map((name) => (
                    <Pressable
                      key={name}
                      accessibilityRole="button"
                      accessibilityLabel={"Preview " + name}
                      onPress={() => navigate(name)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 18,
                        backgroundColor:
                          screen === name
                            ? theme.colors.primary
                            : theme.colors.card,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          color:
                            screen === name ? "#FFF" : theme.colors.textHeading,
                        }}
                      >
                        {name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {ready && (
                  <View key={screen + mode} style={{ flex: 1 }}>
                    <Component route={route} navigation={navigation} />
                  </View>
                )}
                <View
                  style={{
                    flexDirection: "row",
                    gap: 16,
                    padding: 10,
                    justifyContent: "center",
                  }}
                >
                  {["normal", "unfiled", "empty", "error"].map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      onPress={() => {
                        useApiCacheStore.getState().clearCache();
                        setMode(value);
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          color:
                            value === mode
                              ? theme.colors.primary
                              : theme.colors.textBody,
                        }}
                      >
                        {value}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </NavigationContext.Provider>
          </DownloadContext.Provider>
        </UploadContext.Provider>
      </AuthContext.Provider>
    </ServerStatusContext.Provider>
  );
}
