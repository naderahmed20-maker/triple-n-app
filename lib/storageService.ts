import { supabase } from '@/lib/supabase';
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

export async function uploadWardrobeImage(uri: string, userId: string) {
  let base64 = '';
  let contentType = 'image/jpeg';
  let extension = 'jpg';

  if (uri.startsWith('data:image/png;base64,')) {
    base64 = uri.replace('data:image/png;base64,', '');
    contentType = 'image/png';
    extension = 'png';
  } else if (uri.startsWith('data:image/jpeg;base64,')) {
    base64 = uri.replace('data:image/jpeg;base64,', '');
    contentType = 'image/jpeg';
    extension = 'jpg';
  } else {
    base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64' as any,
    });
  }

  const fileName = `${Date.now()}.${extension}`;
  const filePath = `${userId}/${fileName}`;

  const { error } = await supabase.storage
    .from('wardrobe')
    .upload(filePath, decode(base64), {
      contentType,
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from('wardrobe')
    .getPublicUrl(filePath);

  return data.publicUrl;
}