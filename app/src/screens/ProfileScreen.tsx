import { LibraryHeader, LibraryShortcut } from "../components/LibraryUI";
import { PlatformAlert as Alert } from "../utils/alert";
import React, {
  useState,
  useEffect,
  useContext,
  useRef,
  useCallback,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Animated,
  Switch,
  Platform,
  Pressable,
} from "react-native";
import {
  ArrowLeft,
  Trash2,
  Edit2,
  LogOut,
  BarChart2,
  Link as LinkIcon,
  ChevronRight,
  Moon,
  ArrowUpDown,
  Bell,
  ShieldCheck,
  CloudDownload,
  Camera,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthContext } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";
import apiClient from "../services/apiClient";
import { SkeletonBlock } from "../ui/Skeleton";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFileRefresh } from "../utils/events";
import { useReducedMotion } from "../hooks/useReducedMotion";
import {
  getNotificationsEnabled,
  setNotificationsEnabled as persistNotificationsEnabled,
} from "../utils/preferences";

export default function ProfileScreen({ navigation }: any) {
  const authCtx = useContext(AuthContext);
  const { showToast } = useToast();
  const { theme, isDark, setThemeMode } = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [stats, setStats] = useState<any>({});
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Moved settings
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const appVersion = Constants.expoConfig?.version || "1.0.0";

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const storageFillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchAll();
    getNotificationsEnabled()
      .then(setNotificationsEnabled)
      .catch(() => setNotificationsEnabled(true));
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: reducedMotion ? 0 : 220,
        useNativeDriver: true,
      }),
      Animated.timing(storageFillAnim, {
        toValue: 1,
        duration: reducedMotion ? 0 : 850,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useFileRefresh(() => {
    fetchAll();
  });

  const fetchAll = async () => {
    setLoading(true);
    setStatsError(false);
    try {
      const statsRes = await apiClient.get("/files/stats");
      if (statsRes.data?.success) setStats(statsRes.data);
      else setStatsError(true);
    } catch {
      setStatsError(true);
    } finally {
      setLoading(false);
    }
  };

  const toggleNotifications = (val: boolean) => {
    setNotificationsEnabled(val);
    persistNotificationsEnabled(val)
      .then(() =>
        showToast(
          val ? "Notifications enabled" : "Notifications disabled",
          "info",
        ),
      )
      .catch(() => showToast("Could not update notifications", "error"));
  };

  const handleThemeToggle = useCallback(
    (value: boolean) => {
      void setThemeMode(value ? "dark" : "light")
        .then(() =>
          showToast(value ? "Dark mode enabled" : "Light mode enabled", "info"),
        )
        .catch(() => showToast("Could not update theme", "error"));
    },
    [setThemeMode, showToast],
  );

  const confirmLogout = useCallback(async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await authCtx?.logout?.();
    } catch {
      showToast("Sign out failed", "error");
    } finally {
      setIsSigningOut(false);
    }
  }, [authCtx, isSigningOut, showToast]);

  const handleLogout = useCallback(() => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => {
          void confirmLogout();
        },
      },
    ]);
  }, [confirmLogout]);

  const formatBytes = (bytes: number) => {
    if (!bytes) return "0 B";
    const k = 1024,
      s = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + s[i];
  };

  const userName = authCtx.user?.name || authCtx.user?.username || "Axya User";
  const userPhone = authCtx.user?.phone || "";
  const avatarLetter = (userName[0] || "?").toUpperCase();
  const usedBytes = Number(stats.totalBytes || stats.total_size || 0);
  const quotaBytes = Number(
    stats.totalQuotaBytes || stats.quotaBytes || stats.total_quota || 0,
  );
  const hasQuota = quotaBytes > 0;
  const storageUsed = formatBytes(usedBytes);
  const usedGBNum = usedBytes / 1024 ** 3;
  const storageProgress = hasQuota
    ? Math.max(0, Math.min(usedBytes / quotaBytes, 1))
    : Math.max(0.02, Math.min(0.92, 0.12 + Math.log10(usedGBNum + 1) * 0.3));

  const handleBack = () => {
    if (navigation?.canGoBack?.()) navigation.goBack();
    else navigation?.navigate?.("MainTabs", { screen: "Home" });
  };

  // Design System Values
  const BG_COLOR = theme.colors.background;
  const CARD_BG = theme.colors.card;
  const BORDER = theme.colors.border;
  const TEXT_MAIN = theme.colors.textHeading;
  const TEXT_SUB = isDark ? "#A5B0C5" : "#65748B";
  const ACCENT = theme.colors.accent;
  const BLUE = theme.colors.primary;
  const SURFACE_MUTED = theme.colors.surfaceMuted;
  const SWITCH_TRACK_OFF = theme.colors.switchTrackOff;

  const renderMenuItem = (
    icon: React.ReactNode,
    iconBg: string,
    title: string,
    onPress?: () => void,
    RightElement?: React.ReactNode,
    isLast = false,
  ) => {
    const content = (
      <>
        <View style={[st.actionIconBox, { backgroundColor: iconBg }]}>
          {icon}
        </View>
        <View style={st.menuRowContent}>
          <Text style={[st.actionCardTitle, { color: TEXT_MAIN }]}>
            {title}
          </Text>
        </View>
      </>
    );
    const border = {
      borderBottomColor: BORDER,
      borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
    };
    if (RightElement)
      return (
        <View style={[st.menuRow, border]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            onPress={onPress}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              minHeight: 48,
            }}
          >
            {content}
          </Pressable>
          {RightElement}
        </View>
      );
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={({ pressed }) => [
          st.menuRow,
          border,
          { backgroundColor: pressed ? SURFACE_MUTED : "transparent" },
        ]}
      >
        {content}
        <ChevronRight color={TEXT_SUB} size={17} />
      </Pressable>
    );
  };

  return (
    <View
      style={[st.root, { backgroundColor: BG_COLOR, paddingTop: insets.top }]}
    >
      <LibraryHeader
        title="Account"
        subtitle="Make Axya yours"
        onBack={handleBack}
      />

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          st.scroll,
          { paddingBottom: 110 + insets.bottom },
        ]}
        style={{ opacity: fadeAnim }}
      >
        <View
          style={{ alignItems: "center", paddingTop: 12, paddingBottom: 28 }}
        >
          <View
            style={{
              padding: 8,
              borderRadius: 48,
              backgroundColor: theme.colors.primaryLight,
            }}
          >
            <LinearGradient
              colors={[
                theme.colors.fabGradientStart,
                theme.colors.fabGradientEnd,
              ]}
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={[st.avatarLetter, { fontSize: 32 }]}>
                {avatarLetter}
              </Text>
            </LinearGradient>
          </View>
          <Text
            style={[
              st.userNameText,
              { color: TEXT_MAIN, fontSize: 24, marginTop: 16 },
            ]}
          >
            {userName}
          </Text>
          <Text style={[st.userPhoneText, { color: TEXT_SUB, marginTop: 4 }]}>
            {userPhone || "Telegram account"}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: theme.colors.primaryLight,
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: 20,
              marginTop: 12,
            }}
          >
            <ShieldCheck color={BLUE} size={14} />
            <Text
              style={{
                color: BLUE,
                fontSize: 11,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              Your personal cloud
            </Text>
          </View>
        </View>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 26,
          }}
        >
          <LibraryShortcut
            title="Offline files"
            detail="Ready without internet"
            icon={CloudDownload}
            tone="mint"
            onPress={() => navigation.navigate("OfflineFiles")}
          />
          <LibraryShortcut
            title="Photo backup"
            detail="Keep memories together"
            icon={Camera}
            tone="violet"
            onPress={() => navigation.navigate("PhotoBackup")}
          />
        </View>
        {/* 2. CLOUD STORAGE PREVIEW */}
        <Text style={[st.sectionLabel, { color: TEXT_SUB }]}>Your library</Text>
        <View
          style={[
            st.card,
            {
              backgroundColor: CARD_BG,
              borderColor: BORDER,
              shadowColor: isDark ? "#020617" : "#0F172A",
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Storage overview"
            style={({ pressed }) => [
              st.storageFlexRow,
              { transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
            onPress={() =>
              statsError ? fetchAll() : navigation.navigate("Analytics")
            }
          >
            <View
              style={[
                st.storageIconBlock,
                { backgroundColor: "rgba(59, 130, 246, 0.1)" },
              ]}
            >
              <BarChart2 color={BLUE} size={22} />
            </View>
            <View style={{ flex: 1, paddingLeft: 12 }}>
              <Text style={[st.storageLabel, { color: TEXT_MAIN }]}>
                Storage overview
              </Text>
              <Text style={[st.storageSub, { color: TEXT_SUB }]}>
                {loading
                  ? "Checking..."
                  : statsError
                    ? "Unavailable · tap to retry"
                    : hasQuota
                      ? `${storageUsed} used of ${formatBytes(quotaBytes)}`
                      : `${storageUsed} stored in Telegram`}
              </Text>
            </View>
            <ChevronRight
              color={TEXT_SUB}
              size={18}
              style={{ opacity: 0.65 }}
            />
          </Pressable>
          {hasQuota && (
            <View
              style={[st.progressTrack, { backgroundColor: SURFACE_MUTED }]}
            >
              {loading ? (
                <SkeletonBlock width="100%" height={6} borderRadius={6} />
              ) : (
                <Animated.View
                  style={{
                    width: `${Math.max(storageProgress * 100, 2)}%`,
                    transform: [{ scaleX: storageFillAnim }],
                  }}
                >
                  <LinearGradient
                    colors={["#60A5FA", "#3B82F6"]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={st.progressFill}
                  />
                </Animated.View>
              )}
            </View>
          )}
        </View>

        {/* 3. PREFERENCES & SETTINGS */}
        <Text style={[st.sectionLabel, { color: TEXT_SUB }]}>Preferences</Text>
        <View
          style={[
            st.card,
            {
              backgroundColor: CARD_BG,
              borderColor: BORDER,
              shadowColor: isDark ? "#020617" : "#0F172A",
            },
          ]}
        >
          {renderMenuItem(
            <Bell color={theme.colors.accent} size={20} />,
            theme.colors.warningSoft,
            "Upload Notifications",
            () => toggleNotifications(!notificationsEnabled),
            <Switch
              accessibilityLabel="Upload notifications"
              value={notificationsEnabled}
              onValueChange={toggleNotifications}
              trackColor={{
                true: theme.colors.accent,
                false: SWITCH_TRACK_OFF,
              }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={SWITCH_TRACK_OFF}
            />,
          )}
          {renderMenuItem(
            <Moon color={theme.colors.purple} size={20} />,
            theme.colors.infoSoft,
            "Dark Mode",
            () => handleThemeToggle(!isDark),
            <Switch
              accessibilityLabel="Dark mode"
              value={isDark}
              onValueChange={handleThemeToggle}
              trackColor={{
                true: theme.colors.purple,
                false: SWITCH_TRACK_OFF,
              }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={SWITCH_TRACK_OFF}
            />,
            true, // last item
          )}
        </View>

        {/* 4. UTILITIES */}
        <Text style={[st.sectionLabel, { color: TEXT_SUB }]}>Manage files</Text>
        <View
          style={[
            st.card,
            {
              backgroundColor: CARD_BG,
              borderColor: BORDER,
              shadowColor: isDark ? "#020617" : "#0F172A",
            },
          ]}
        >
          {renderMenuItem(
            <ShieldCheck color={BLUE} size={20} />,
            theme.colors.primaryLight,
            "Drive health & duplicates",
            () => navigation.navigate("DriveHealth"),
          )}
          {renderMenuItem(
            <ShieldCheck color={BLUE} size={20} />,
            theme.colors.primaryLight,
            "Drive tools",
            () => navigation.navigate("DriveTools"),
          )}
          {renderMenuItem(
            <ArrowUpDown color={BLUE} size={20} />,
            theme.colors.primaryLight,
            "Transfers",
            () => navigation.navigate("UploadManager"),
          )}
          {renderMenuItem(
            <LinkIcon color="#10B981" size={20} />,
            theme.colors.successSoft,
            "Shared Links",
            () => navigation.navigate("SharedLinks"),
          )}
          {renderMenuItem(
            <Trash2 color="#EF4444" size={20} />,
            theme.colors.dangerSoft,
            "Trash",
            () => navigation.navigate("Trash"),
            undefined,
            true,
          )}
        </View>

        {/* 5. LOGOUT */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={handleLogout}
          disabled={isSigningOut}
          style={({ pressed }) => [
            st.logoutBtn,
            {
              borderColor: isDark ? "#7F1D1D" : "#FECACA",
              backgroundColor: isDark
                ? "rgba(239,68,68,0.12)"
                : "rgba(239,68,68,0.08)",
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          <LogOut color="#EF4444" size={20} strokeWidth={2.5} />
          <Text style={st.logoutBtnText}>
            {isSigningOut ? "Signing out..." : "Sign Out"}
          </Text>
        </Pressable>

        <View style={st.versionRow}>
          <Text style={[st.versionText, { color: TEXT_SUB }]}>
            Axya v{appVersion}
          </Text>
        </View>

        <View style={{ height: 60 }} />
      </Animated.ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minHeight: 72,
  },
  headerBtn: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.6,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  scroll: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 120,
    maxWidth: 680,
    width: "100%",
    alignSelf: "center",
  },

  /* Profile Center */
  profileCenterCol: { alignItems: "center", marginBottom: 28 },
  avatarWrap: { position: "relative", marginBottom: 14 },
  avatarCircle: {
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    width: 88,
    height: 88,
    borderRadius: 28,
    shadowOpacity: 0,
    elevation: 0,
  },
  avatarLetter: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 32,
    fontFamily: "Inter_700Bold",
  },
  editIconBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  profileInfoCol: { alignItems: "center" },
  userNameText: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 4,
    letterSpacing: 0.2,
    fontFamily: "Inter_600SemiBold",
  },
  userPhoneText: {
    fontSize: 14,
    fontWeight: "500",
    opacity: 0.85,
    fontFamily: "Inter_500Medium",
  },

  /* Sections */
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
    paddingLeft: 4,
    letterSpacing: 0,
    fontFamily: "Inter_700Bold",
  },
  card: {
    borderWidth: 0,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    borderRadius: 26,
    marginBottom: 24,
    shadowOpacity: 0,
    elevation: 0,
  },

  /* Storage Row */
  storageFlexRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
  },
  storageIconBlock: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  storageLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
    letterSpacing: 0.2,
    fontFamily: "Inter_600SemiBold",
  },
  storageSub: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  progressTrack: {
    height: 6,
    borderRadius: 6,
    marginHorizontal: 20,
    marginBottom: 18,
    overflow: "hidden",
  },
  progressFill: { height: 6, borderRadius: 6 },

  /* Menu Items */
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    minHeight: 80,
    paddingVertical: 14,
  },
  actionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    opacity: 0.92,
  },
  menuRowContent: { flex: 1 },
  actionCardTitle: {
    fontWeight: "500",
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },

  /* Logout */
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderWidth: 1,
    marginTop: 12,
    gap: 10,
    minHeight: 44,
    borderRadius: 12,
  },
  logoutBtnText: {
    color: "#EF4444",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  versionRow: { alignItems: "center", marginTop: 24 },
  versionText: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
});
