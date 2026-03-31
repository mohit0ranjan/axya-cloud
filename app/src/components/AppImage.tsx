import React, { useMemo } from 'react';
import { Image as ExpoImage, ImageProps as ExpoImageProps } from 'expo-image';
import { sanitizeRemoteUri } from '../utils/fileSafety';

export type AppImageProps = ExpoImageProps & {
  // any custom props if needed
};

export const Image = React.memo((props: AppImageProps) => {
  const { source: rawSource, ...rest } = props;

  const source = useMemo(() => {
    if (rawSource && !Array.isArray(rawSource) && typeof rawSource === 'object' && 'uri' in rawSource) {
      return { ...rawSource, uri: sanitizeRemoteUri(String((rawSource as any).uri || '')) };
    }
    return rawSource;
  }, [
    rawSource && typeof rawSource === 'object' && !Array.isArray(rawSource) ? (rawSource as any).uri : rawSource,
    rawSource && typeof rawSource === 'object' && !Array.isArray(rawSource) ? JSON.stringify((rawSource as any).headers) : null
  ]);

  return <ExpoImage cachePolicy="memory-disk" {...rest} source={source} />;
});

export default Image;
