import { supabase } from '@/lib/supabase';

export type WardrobeItem = {
  id: string;
  image: string;
  category: string;
  subCategory?: string | null;
  name?: string;
  favorite?: boolean;
  created_at?: string;
  color?: string;
  shade?: string | null;
  imageBackground?: string;
};

export async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export async function getMyWardrobeItems() {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Login required');
  }

  const { data, error } = await supabase
    .from('wardrobe_items')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data || []) as WardrobeItem[];
}

export async function createWardrobeItem(item: {
  image: string;
  category: string;
  subCategory?: string | null;
  name?: string;
  color?: string;
  shade?: string | null;
}) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Login required');
  }

  const { error } = await supabase
    .from('wardrobe_items')
    .insert({
      user_id: user.id,
      image: item.image,
      category: item.category,
      subCategory: item.subCategory ?? null,
      name: item.name,
      color: item.color,
      shade: item.shade ?? null,
      favorite: false,
    });

  if (error) {
    throw error;
  }
}

export async function updateWardrobeItem(
  id: string,
  item: Partial<WardrobeItem>
) {
  const { error } = await supabase
    .from('wardrobe_items')
    .update(item)
    .eq('id', id);

  if (error) {
    throw error;
  }
}

export async function deleteWardrobeItems(ids: string[]) {
  const { error } = await supabase
    .from('wardrobe_items')
    .delete()
    .in('id', ids);

  if (error) {
    throw error;
  }
}

export async function toggleWardrobeFavorite(
  id: string,
  favorite: boolean
) {
  await updateWardrobeItem(id, { favorite });
}