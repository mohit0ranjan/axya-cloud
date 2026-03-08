import React, { useEffect, useState } from 'react';
import {
  Image as RNImage,
  ImageProps as RNImageProps,
  ImageSourcePropType,
  Platform,
} from 'react-native';

type RemoteSource = {
  uri: string;
  headers?: Record<string, string>;
};

type AppImageProps = Omit<RNImageProps, 'source' | 'resizeMode'> & {
  source: ImageSourcePropType | RemoteSource;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  cachePolicy?: 'none' | 'disk' | 'memory' | 'memory-disk';
  transition?: number;
};

function isRemoteSource(source: AppImageProps['source']): source is RemoteSource {
  return typeof source === 'object' && source !== null && 'uri' in source;
}

function mapContentFitToResizeMode(contentFit?: AppImageProps['contentFit']): RNImageProps['resizeMode'] {
  switch (contentFit) {
    case 'cover':
      return 'cover';
    case 'contain':
    case 'none':
    case 'scale-down':
      return 'contain';
    case 'fill':
      return 'stretch';
    default:
      return 'cover';
  }
}

export function Image({ source, contentFit, onError, ...rest }: AppImageProps) {
  const [webSource, setWebSource] = useState<ImageSourcePropType>(source as ImageSourcePropType);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isRemoteSource(source) || !source.headers) {
      setWebSource(source as ImageSourcePropType);
      return;
    }

    let revokedUrl: string | null = null;
    let cancelled = false;

    const loadImage = async () => {
      try {
        const response = await fetch(source.uri, { headers: source.headers });
        if (!response.ok) {
          throw new Error(`Image request failed with status ${response.status}`);
        }
        const blob = await response.blob();
        if (cancelled) {
          return;
        }
        revokedUrl = URL.createObjectURL(blob);
        setWebSource({ uri: revokedUrl });
      } catch (error) {
        if (!cancelled) {
          setWebSource(source as ImageSourcePropType);
          onError?.({ nativeEvent: { error: error instanceof Error ? error.message : 'Image load failed' } });
        }
      }
    };

    void loadImage();

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [onError, source]);

  return <RNImage {...rest} source={Platform.OS === 'web' ? webSource : (source as ImageSourcePropType)} resizeMode={mapContentFitToResizeMode(contentFit)} />;
}

export default Image;
