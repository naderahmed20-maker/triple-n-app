import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rshxkasiriapshmeieks.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_B_K9jFWWxecI_i6vp4f8Xw_MFYr_6Mj';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});