import { supabase } from '@/lib/supabase';

export type SavedOutfit = {
  top: any;
  pants: any;
  bottom?: any;
  shoes: any;
  jacket: any;
  accessory?: any;
  score?: number;
  aiScore?: number;
  colorScore?: number;
  weatherScore?: number;
  seasonScore?: number;
  styleScore?: number;
  explanation?: string[];
  occasion?: string;
  weather?: string;
  season?: string;
  createdAt?: number;
};

export type SavedOutfitRow = {
  id: string;
  user_id: string;
  outfit: SavedOutfit;
  favorite: boolean;
  created_at: string;
};

async function getUser() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) throw new Error('Login required');
  return data.session.user;
}

export async function getSavedOutfits() {
  const user = await getUser();

  const { data, error } = await supabase
    .from('saved_outfits')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as SavedOutfitRow[];
}

export async function getSavedOutfitById(id: string) {
  const { data, error } = await supabase
    .from('saved_outfits')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data as SavedOutfitRow;
}

export async function saveOutfit(outfit: SavedOutfit) {
  const user = await getUser();

  const { error } = await supabase.from('saved_outfits').insert({
    user_id: user.id,
    outfit,
    favorite: false,
  });

  if (error) throw error;
}

export async function updateOutfitFavorite(id: string, favorite: boolean) {
  const { error } = await supabase
    .from('saved_outfits')
    .update({ favorite })
    .eq('id', id);

  if (error) throw error;
}

export async function deleteOutfit(id: string) {
  const { error } = await supabase
    .from('saved_outfits')
    .delete()
    .eq('id', id);

  if (error) throw error;
}