import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import { useReducedMotion } from "../hooks/useReducedMotion";

/** Shared launch branding. Only the accent ring moves while loading. */
export default function AxyaBrandMark({
  size = 208,
  loading = false,
}: {
  size?: number;
  loading?: boolean;
}) {
  const { theme } = useTheme();
  const C = theme.colors;
  const reducedMotion = useReducedMotion();
  const rotation = useRef(new Animated.Value(0)).current;
  const frameSize = Math.max(104, (size * 124) / 208);
  const imageSize = frameSize - (size < 208 ? 8 : 12);

  useEffect(() => {
    rotation.setValue(0);
    if (!loading || reducedMotion) return;
    const motion = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    motion.start();
    return () => {
      motion.stop();
      rotation.stopAnimation();
    };
  }, [loading, reducedMotion, rotation]);

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessible
      accessibilityRole={loading ? "progressbar" : "image"}
      accessibilityLabel={loading ? "Opening Axya" : "Axya logo"}
    >
      <View
        style={{
          position: "absolute",
          width: (size * 174) / 208,
          height: (size * 174) / 208,
          borderRadius: size / 2,
          backgroundColor: C.primaryLight,
          opacity: 0.65,
        }}
      />
      <Animated.View
        style={{
          ...StyleSheet.absoluteFillObject,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: `${C.primary}18`,
          transform: [
            {
              rotate: rotation.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "360deg"],
              }),
            },
          ],
        }}
      >
        <View
          style={{
            position: "absolute",
            right: (size * 23) / 208,
            top: (size * 19) / 208,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: C.accent,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: (size * 23) / 208,
            bottom: (size * 20) / 208,
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: C.primary,
          }}
        />
      </Animated.View>
      <View
        style={{
          width: frameSize,
          height: frameSize,
          borderRadius: 32,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.card,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#2563EB",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.08,
          shadowRadius: 18,
          elevation: 2,
        }}
      >
        <Image
          source={require("../../assets/icon.png")}
          style={{ width: imageSize, height: imageSize, borderRadius: 28 }}
          resizeMode="contain"
          accessible={false}
        />
      </View>
    </View>
  );
}
