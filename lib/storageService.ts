import { supabase } from '@/lib/supabase';

import { decode } from 'base64-arraybuffer';

import * as FileSystem from 'expo-file-system/legacy';

function createUniqueFileName(
  extension: 'png' | 'jpg'
) {
  const randomPart =
    Math.random()
      .toString(36)
      .slice(2, 10);

  return `${Date.now()}-${randomPart}.${extension}`;
}

function resolveImageFormat(
  uri: string
): {
  contentType:
    'image/png' |
    'image/jpeg';

  extension:
    'png' |
    'jpg';

  inlineBase64:
    string | null;
} {
  if (
    uri.startsWith(
      'data:image/png;base64,'
    )
  ) {
    return {
      contentType:
        'image/png',

      extension:
        'png',

      inlineBase64:
        uri.replace(
          'data:image/png;base64,',
          ''
        ),
    };
  }

  if (
    uri.startsWith(
      'data:image/jpeg;base64,'
    ) ||
    uri.startsWith(
      'data:image/jpg;base64,'
    )
  ) {
    return {
      contentType:
        'image/jpeg',

      extension:
        'jpg',

      inlineBase64:
        uri
          .replace(
            'data:image/jpeg;base64,',
            ''
          )
          .replace(
            'data:image/jpg;base64,',
            ''
          ),
    };
  }

  const normalizedUri =
    uri
      .split('?')[0]
      .split('#')[0]
      .toLowerCase();

  if (
    normalizedUri.endsWith(
      '.png'
    )
  ) {
    return {
      contentType:
        'image/png',

      extension:
        'png',

      inlineBase64:
        null,
    };
  }

  return {
    contentType:
      'image/jpeg',

    extension:
      'jpg',

    inlineBase64:
      null,
  };
}

export async function uploadWardrobeImage(
  uri: string,
  userId: string
) {
  if (
    !uri ||
    uri.trim().length === 0
  ) {
    throw new Error(
      'The wardrobe image URI is missing.'
    );
  }

  if (
    !userId ||
    userId.trim().length === 0
  ) {
    throw new Error(
      'The user ID is missing.'
    );
  }

  const {
    contentType,
    extension,
    inlineBase64,
  } =
    resolveImageFormat(
      uri
    );

  let base64 =
    inlineBase64;

  if (!base64) {
    try {
      const fileInfo =
        await FileSystem
          .getInfoAsync(
            uri
          );

      if (
        !fileInfo.exists
      ) {
        throw new Error(
          'The wardrobe image file does not exist.'
        );
      }

      base64 =
        await FileSystem
          .readAsStringAsync(
            uri,
            {
              encoding:
                'base64' as any,
            }
          );
    } catch (
      error: unknown
    ) {
      const message =
        error instanceof Error
          ? error.message
          : 'The wardrobe image could not be read.';

      throw new Error(
        message
      );
    }
  }

  if (
    !base64 ||
    base64.length === 0
  ) {
    throw new Error(
      'The wardrobe image data is empty.'
    );
  }

  const fileName =
    createUniqueFileName(
      extension
    );

  const filePath =
    `${userId}/${fileName}`;

  const {
    error,
  } =
    await supabase
      .storage
      .from(
        'wardrobe'
      )
      .upload(
        filePath,
        decode(
          base64
        ),
        {
          contentType,

          upsert:
            false,

          cacheControl:
            '31536000',
        }
      );

  if (error) {
    throw new Error(
      error.message ||
      'The wardrobe image could not be uploaded.'
    );
  }

  const {
    data,
  } =
    supabase
      .storage
      .from(
        'wardrobe'
      )
      .getPublicUrl(
        filePath
      );

  if (
    !data.publicUrl
  ) {
    throw new Error(
      'The wardrobe image URL could not be created.'
    );
  }

  return data.publicUrl;
}