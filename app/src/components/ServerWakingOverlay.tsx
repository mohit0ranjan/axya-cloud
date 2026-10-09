import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Animated,
  Platform,
  TouchableOpacity,
} from "react-native";
import { Server } from "lucide-react-native";
import { useServerStatus } from "../context/ServerStatusContext";
import { useTheme } from "../context/ThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ServerWakingOverlay() {
  const { isWaking, statusText, wakeTimedOut, retryWake } = useServerStatus();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isWaking) {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -120,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isWaking]);

  if (!isWaking) return null;
  return (
    <Animated.View
      style={[
        styles.overlay,
        { top: insets.top + 12, opacity, transform: [{ translateY }] },
      ]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <View style={styles.iconCircle}>
          <Server color="#4B6EF5" size={18} />
        </View>
        <View style={styles.content}>
          <Text style={[styles.title, { color: theme.colors.textHeading }]}>
            Connecting to your storage
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.textBody }]}>
            {wakeTimedOut
              ? "Connection is taking longer. Your uploads remain queued."
              : "Please wait a moment. Your uploads remain queued."}
          </Text>
          {wakeTimedOut ? (
            <TouchableOpacity
              onPress={retryWake}
              style={styles.retryButton}
              activeOpacity={0.85}
            >
              <Text style={styles.retryText}>Retry wake-up</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <ActivityIndicator size="small" color="#4B6EF5" style={styles.loader} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
    elevation: 10,
    pointerEvents: "box-none",
  },
  card: {
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    shadowColor: "#4B6EF5",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 12,
    width: "90%",
    maxWidth: 400,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#EEF1FD",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flex: 1,
    marginLeft: 12,
  },
  loader: {
    marginLeft: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "800",
    color: "#1A1F36",
  },
  subtitle: {
    fontSize: 11,
    color: "#8892A4",
    fontWeight: "600",
    marginTop: 1,
  },
  retryButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#EEF1FD",
    borderWidth: 1,
    borderColor: "#C7D2FE",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  retryText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#3652D9",
  },
});
