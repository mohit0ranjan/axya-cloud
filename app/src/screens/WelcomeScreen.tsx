import React, { useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowRight } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import AxyaBrandMark from "../components/AxyaBrandMark";
import { useTheme } from "../context/ThemeContext";
import { useReducedMotion } from "../hooks/useReducedMotion";

export default function WelcomeScreen({ navigation }: any) {
  const { theme } = useTheme();
  const C = theme.colors;
  const { height } = useWindowDimensions();
  const compact = height < 700;
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const offset = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    const motion = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: reducedMotion ? 0 : 280,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(offset, {
        toValue: 0,
        duration: reducedMotion ? 0 : 320,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]);
    motion.start();
    return () => motion.stop();
  }, [opacity, offset, reducedMotion]);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: C.background }]}>
      <ScrollView
        contentContainerStyle={[s.content, compact && { paddingVertical: 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[s.welcome, { opacity, transform: [{ translateY: offset }] }]}
        >
          <View style={[s.hero, compact && { marginBottom: 20 }]}>
            <AxyaBrandMark size={compact ? 160 : 208} />
            <Text
              accessibilityRole="header"
              style={[s.brandName, { color: C.textHeading }]}
            >
              Axya
            </Text>
          </View>

          <View
            style={[
              s.sheet,
              { backgroundColor: C.card, borderColor: C.border },
              compact && { padding: 20 },
            ]}
          >
            <View
              style={[s.sheetHandle, { backgroundColor: C.primaryLight }]}
              accessible={false}
            />
            <Text style={[s.headline, { color: C.textHeading }]}>
              Your personal{"\n"}
              <Text style={{ color: C.primary }}>cloud.</Text>
            </Text>
            <Text style={[s.subtitle, { color: C.textBody }]}>
              Photos, files and memories. Together on Telegram.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.86}
              onPress={() => navigation.navigate("Auth")}
              style={s.cta}
            >
              <LinearGradient
                colors={[C.fabGradientStart, C.fabGradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.buttonFill}
              >
                <Text style={s.ctaText}>Get started</Text>
                <ArrowRight size={20} color="#FFFFFF" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 28,
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
  },
  welcome: { width: "100%" },
  hero: { alignItems: "center", marginBottom: 28 },
  orbit: {
    width: 208,
    height: 208,
    borderRadius: 104,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: 174,
    height: 174,
    borderRadius: 87,
    opacity: 0.65,
  },
  logoFrame: {
    width: 124,
    height: 124,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 2,
  },
  logo: { width: 112, height: 112, borderRadius: 28 },
  goldAccent: {
    position: "absolute",
    right: 23,
    top: 19,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  blueAccent: {
    position: "absolute",
    bottom: 20,
    left: 23,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  brandName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 26,
    lineHeight: 34,
    letterSpacing: -0.7,
    marginTop: 16,
  },
  sheet: {
    padding: 24,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: "center",
  },
  sheetHandle: { width: 32, height: 4, borderRadius: 2, marginBottom: 18 },
  headline: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 30,
    lineHeight: 37,
    letterSpacing: -0.9,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 12,
    maxWidth: 280,
  },
  cta: { width: "100%", marginTop: 24, borderRadius: 16, overflow: "hidden" },
  buttonFill: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  ctaText: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 16 },
});
