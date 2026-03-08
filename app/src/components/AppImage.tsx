import React from 'react';
import { Image as ExpoImage, ImageProps as ExpoImageProps } from 'expo-image';

export type AppImageProps = ExpoImageProps & {
  // any custom props if needed
};

export function Image(props: AppImageProps) {
  return <ExpoImage cachePolicy="memory-disk" {...props} />;
}

export default Image;
