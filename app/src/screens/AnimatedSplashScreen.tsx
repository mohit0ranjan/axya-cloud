import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ExpoSplashScreen from "expo-splash-screen";
import AxyaBrandMark from "../components/AxyaBrandMark";
import { useTheme } from "../context/ThemeContext";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface Props {
  onAnimationComplete: () => void;
  isAuthLoading: boolean;
  /** Development-only visual review; never changes authentication. */
  preview?: boolean;
}

export default function AnimatedSplashScreen({
  onAnimationComplete,
  isAuthLoading,
  preview = false,
}: Props) {
  const { theme } = useTheme();
  const C = theme.colors;
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentOffset = useRef(new Animated.Value(6)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const completeRef = useRef(onAnimationComplete);
  completeRef.current = onAnimationComplete;
  const nativeDriver = Platform.OS !== "web";

  useEffect(() => {
    void ExpoSplashScreen.hideAsync().catch(() => {});
    const timer = setTimeout(() => setMinimumElapsed(true), 700);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const entrance = Animated.parallel([
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: reducedMotion ? 0 : 240,
        useNativeDriver: nativeDriver,
      }),
      Animated.timing(contentOffset, {
        toValue: 0,
        duration: reducedMotion ? 0 : 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: nativeDriver,
      }),
    ]);
    entrance.start();
    return () => entrance.stop();
  }, [reducedMotion, contentOpacity, contentOffset, nativeDriver]);

  useEffect(() => {
    if (!minimumElapsed || isAuthLoading || preview) return;
    const exit = Animated.timing(screenOpacity, {
      toValue: 0,
      duration: reducedMotion ? 0 : 180,
      useNativeDriver: nativeDriver,
    });
    exit.start(({ finished }) => {
      if (finished) completeRef.current();
    });
    return () => exit.stop();
  }, [
    minimumElapsed,
    isAuthLoading,
    preview,
    reducedMotion,
    screenOpacity,
    nativeDriver,
  ]);

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[
        styles.screen,
        { backgroundColor: C.background, opacity: screenOpacity },
      ]}
    >
      <Animated.View
        style={[
          styles.brand,
          {
            opacity: contentOpacity,
            transform: [{ translateY: contentOffset }],
          },
        ]}
      >
        <AxyaBrandMark loading />
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: C.textHeading }]}
        >
          Axya
        </Text>
      </Animated.View>
      <View
        style={[styles.footer, { bottom: Math.max(insets.bottom, 24) + 16 }]}
      >
        <Text style={[styles.footerText, { color: C.textBody }]}>
          Powered by Telegram
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    alignItems: "center",
    width: "100%",
    paddingHorizontal: 24,
    paddingBottom: 52,
  },
  logoFrame: {
    width: 96,
    height: 96,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 88, height: 88 },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 34,
    lineHeight: 44,
    letterSpacing: -1,
    marginTop: 22,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 22,
    marginTop: 6,
    textAlign: "center",
  },
  footer: { position: "absolute", left: 24, right: 24, alignItems: "center" },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 24,
    gap: 10,
  },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  footerText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 18,
  },
  staticDot: { width: 5, height: 5, borderRadius: 3 },
});
