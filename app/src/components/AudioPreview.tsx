import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Music2, Pause, Play, RotateCcw, RotateCw } from "lucide-react-native";
import { useTheme } from "../context/ThemeContext";
const time = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds || 0) / 60)}:${Math.floor(
    Math.max(0, seconds || 0) % 60,
  )
    .toString()
    .padStart(2, "0")}`;
export default function AudioPreview({
  url,
  token,
  name,
  active,
}: {
  url: string;
  token: string;
  name: string;
  active: boolean;
}) {
  const { theme } = useTheme();
  const C = theme.colors;
  const player = useAudioPlayer({
    uri: url,
    headers: { Authorization: `Bearer ${token}` },
  }, { crossOrigin: 'use-credentials' });
  const status = useAudioPlayerStatus(player);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);
  useEffect(() => {
    if (status.isLoaded) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [status.isLoaded]);
  const progress = status.duration
    ? Math.min(100, (status.currentTime / status.duration) * 100)
    : 0;
  return (
    <View style={s.root}>
      <View
        style={[
          s.artwork,
          { backgroundColor: C.primaryLight, borderColor: C.border },
        ]}
      >
        <Music2 size={60} color={C.primary} strokeWidth={1.4} />
      </View>
      <Text style={[s.name, { color: C.textHeading }]} numberOfLines={2}>
        {name}
      </Text>
      <Text style={[s.subtitle, { color: C.textBody }]}>Audio file</Text>
      <View style={[s.track, { backgroundColor: C.border }]}>
        <View
          style={[
            s.fill,
            { backgroundColor: C.primary, width: `${progress}%` },
          ]}
        />
      </View>
      <View style={s.times}>
        <Text style={[s.time, { color: C.textBody }]}>
          {time(status.currentTime)}
        </Text>
        <Text style={[s.time, { color: C.textBody }]}>
          {time(status.duration)}
        </Text>
      </View>
      <View style={s.controls}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back 10 seconds"
          disabled={!status.isLoaded}
          style={s.skip}
          onPress={() =>
            void player.seekTo(Math.max(0, status.currentTime - 10))
          }
        >
          <RotateCcw color={C.textHeading} size={24} />
          <Text style={[s.skipLabel, { color: C.textBody }]}>10</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={status.playing ? "Pause audio" : "Play audio"}
          disabled={!status.isLoaded || !active}
          style={[s.play, { backgroundColor: C.primary }]}
          onPress={() => {
            if (status.playing) player.pause();
            else {
              if (status.didJustFinish)
                void player.seekTo(0).then(() => player.play());
              else player.play();
            }
          }}
        >
          {!status.isLoaded || status.isBuffering ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : status.playing ? (
            <Pause size={26} color="#FFFFFF" />
          ) : (
            <Play size={26} color="#FFFFFF" />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go forward 10 seconds"
          disabled={!status.isLoaded}
          style={s.skip}
          onPress={() =>
            void player.seekTo(
              Math.min(status.duration, status.currentTime + 10),
            )
          }
        >
          <RotateCw color={C.textHeading} size={24} />
          <Text style={[s.skipLabel, { color: C.textBody }]}>10</Text>
        </TouchableOpacity>
      </View>
      {slow && (
        <Text accessibilityRole="alert" style={[s.slow, { color: C.textBody }]}>
          Audio is taking longer to load. Check your connection or download the
          original below.
        </Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  artwork: {
    width: 150,
    height: 150,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  name: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    lineHeight: 26,
    textAlign: "center",
  },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 6 },
  track: {
    width: "100%",
    maxWidth: 340,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 28,
  },
  fill: { height: "100%", borderRadius: 2 },
  times: {
    width: "100%",
    maxWidth: 340,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  time: { fontFamily: "Inter_400Regular", fontSize: 11 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 28,
    marginTop: 22,
  },
  play: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  skip: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  skipLabel: { fontFamily: "Inter_500Medium", fontSize: 10, marginTop: 3 },
  slow: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 16,
  },
});
