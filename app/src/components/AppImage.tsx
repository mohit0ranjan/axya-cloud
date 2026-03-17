import React from 'react';
import { Image as ExpoImage, ImageProps as ExpoImageProps } from 'expo-image';
import { sanitizeRemoteUri } from '../utils/fileSafety';

export type AppImageProps = ExpoImageProps & {
  // any custom props if needed
};

export function Image(props: AppImageProps) {
  const source = props.source && !Array.isArray(props.source) && typeof props.source === 'object' && 'uri' in props.source
    ? { ...props.source, uri: sanitizeRemoteUri(String((props.source as any).uri || '')) }
    : props.source;

  return <ExpoImage cachePolicy="memory-disk" {...props} source={source} />;
}

export default Image;
