import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Image as ExpoImage, ImageProps as ExpoImageProps } from 'expo-image';

export type AppImageProps = ExpoImageProps;

// Browser image elements cannot send Authorization headers. Fetch privately,
// then give the renderer an opaque local URL; credentials never enter the URL.
export const Image = React.memo((props: AppImageProps) => {
  const { source: rawSource, ...rest } = props;
  const uri = rawSource && typeof rawSource === 'object' && !Array.isArray(rawSource)
    ? (rawSource as any).uri : undefined;
  const headerKey = rawSource && typeof rawSource === 'object' && !Array.isArray(rawSource)
    ? JSON.stringify((rawSource as any).headers || {}) : '{}';
  const source = rawSource;
  const privateWebImage = Platform.OS === 'web' && /^https?:\/\//i.test(uri || '') && headerKey !== '{}';
  const [local, setLocal] = useState<{ key: string; uri: string } | null>(null);
  const key = `${uri}|${headerKey}`;
  const callbacks = useRef(rest);
  callbacks.current = rest;

  useEffect(() => {
    if (!privateWebImage) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let mounted = true;
    const timeout = setTimeout(() => controller.abort(), 60000);
    callbacks.current.onLoadStart?.();
    (async () => {
      try {
        const response = await fetch(uri, { headers: JSON.parse(headerKey), signal: controller.signal });
        if (!response.ok) throw new Error(`Image request failed (${response.status})`);
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLocal({ key, uri: objectUrl });
      } catch (error) {
        if (mounted) callbacks.current.onError?.({ error: controller.signal.aborted ? 'Image request timed out. Please retry.' : String(error) });
      } finally { clearTimeout(timeout); }
    })();
    return () => {
      mounted = false;
      controller.abort();
      clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [privateWebImage, key]);

  return <ExpoImage cachePolicy="memory-disk" {...rest}
    placeholder={privateWebImage && rest.placeholder && typeof rest.placeholder === 'object' && 'uri' in rest.placeholder ? undefined : rest.placeholder}
    source={privateWebImage ? (local?.key === key ? { uri: local.uri } : undefined) : source} />;
});
export default Image;
