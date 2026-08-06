import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  supabase,
} from '@/lib/supabase';

const BACKEND_URL =
  process.env
    .EXPO_PUBLIC_BACKEND_URL ||
  'https://triplen-backend-production.up.railway.app';

const SETTINGS_KEY =
  'TRIPLE_N_SETTINGS';

type ServiceMessageKey =
  | 'loginRequired'
  | 'verifySession'
  | 'signInAgain'
  | 'invalidResponse'
  | 'sessionExpired'
  | 'tooManyRequests'
  | 'deleteFailed'
  | 'retryFailed'
  | 'cancelFailed'
  | 'metricsFailed';

type SavedSettings = {
  language?: string;
};

const SERVICE_MESSAGES: Record<
  'English' | 'Italian',
  Record<
    ServiceMessageKey,
    string
  >
> = {
  English: {
    loginRequired:
      'Login required',

    verifySession:
      'Could not verify login session',

    signInAgain:
      'Please sign in again',

    invalidResponse:
      'The server returned an invalid response',

    sessionExpired:
      'Your session has expired. Please sign in again',

    tooManyRequests:
      'Too many requests. Please wait and try again',

    deleteFailed:
      'Could not delete items',

    retryFailed:
      'Could not retry item',

    cancelFailed:
      'Could not cancel item',

    metricsFailed:
      'Could not load metrics',
  },

  Italian: {
    loginRequired:
      'Accesso richiesto',

    verifySession:
      'Impossibile verificare la sessione di accesso',

    signInAgain:
      'Accedi nuovamente',

    invalidResponse:
      'Il server ha restituito una risposta non valida',

    sessionExpired:
      'La sessione è scaduta. Accedi nuovamente',

    tooManyRequests:
      'Troppe richieste. Attendi e riprova',

    deleteFailed:
      'Impossibile eliminare gli articoli',

    retryFailed:
      'Impossibile riprovare l’elaborazione dell’articolo',

    cancelFailed:
      'Impossibile annullare l’elaborazione dell’articolo',

    metricsFailed:
      'Impossibile caricare le statistiche',
  },
};

export type ProcessingStatus =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'cancelled';

export type WardrobeItem = {
  id: string;

  image: string;

  category: string;

  subCategory?:
    | string
    | null;

  name?: string;

  favorite?: boolean;

  created_at?: string;

  color?: string;

  shade?:
    | string
    | null;

  imageBackground?: string;

  processing_status?:
    ProcessingStatus;

  processing_error?:
    | string
    | null;

  original_image_path?:
    | string
    | null;

  cleaned_image_path?:
    | string
    | null;

  processing_started_at?:
    | string
    | null;

  processing_finished_at?:
    | string
    | null;
};

type BackendResponse<T = unknown> = {
  success?: boolean;

  message?: string;

  data?: T;
};

async function getServiceLanguage(): Promise<
  'English' | 'Italian'
> {
  try {
    const saved =
      await AsyncStorage.getItem(
        SETTINGS_KEY
      );

    if (!saved) {
      return 'English';
    }

    const settings =
      JSON.parse(
        saved
      ) as SavedSettings;

    const language =
      String(
        settings.language ||
          ''
      )
        .trim()
        .toLowerCase();

    if (
      language ===
        'italian' ||
      language ===
        'italiano' ||
      language ===
        'it' ||
      language.startsWith(
        'it-'
      ) ||
      language.startsWith(
        'it_'
      )
    ) {
      return 'Italian';
    }

    return 'English';
  } catch {
    return 'English';
  }
}

async function getServiceMessage(
  key: ServiceMessageKey
) {
  const language =
    await getServiceLanguage();

  return SERVICE_MESSAGES[
    language
  ][key];
}

async function parseBackendResponse<
  T = unknown,
>(
  response: Response
): Promise<
  BackendResponse<T>
> {
  const text =
    await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(
      text
    ) as BackendResponse<T>;
  } catch {
    throw new Error(
      await getServiceMessage(
        'invalidResponse'
      )
    );
  }
}

async function getAuthenticatedSession() {
  const {
    data: {
      session,
    },

    error,
  } =
    await supabase
      .auth
      .getSession();

  if (error) {
    throw new Error(
      await getServiceMessage(
        'verifySession'
      )
    );
  }

  if (
    !session
      ?.access_token
  ) {
    throw new Error(
      await getServiceMessage(
        'signInAgain'
      )
    );
  }

  return session;
}

async function throwBackendError(
  response: Response,
  result:
    BackendResponse,
  fallbackKey:
    ServiceMessageKey
): Promise<never> {
  if (
    response.status ===
    401
  ) {
    throw new Error(
      await getServiceMessage(
        'sessionExpired'
      )
    );
  }

  if (
    response.status ===
    429
  ) {
    throw new Error(
      await getServiceMessage(
        'tooManyRequests'
      )
    );
  }

  /*
   * لا نعرض رسالة Backend الإنجليزية
   * للمستخدم عند اختيار الإيطالية.
   */
  const language =
    await getServiceLanguage();

  if (
    language ===
      'English' &&
    result.message
  ) {
    throw new Error(
      result.message
    );
  }

  throw new Error(
    await getServiceMessage(
      fallbackKey
    )
  );
}

export async function getCurrentUser() {
  const {
    data,
  } =
    await supabase
      .auth
      .getSession();

  return (
    data.session
      ?.user ??
    null
  );
}

export async function getMyWardrobeItems() {
  const user =
    await getCurrentUser();

  if (!user) {
    throw new Error(
      await getServiceMessage(
        'loginRequired'
      )
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        'wardrobe_items'
      )
      .select('*')
      .eq(
        'user_id',
        user.id
      )
      .order(
        'created_at',
        {
          ascending:
            false,
        }
      );

  if (error) {
    throw error;
  }

  console.log(
  'WARDROBE DATABASE IMAGES:',
  (data || []).map(
    item => ({
      id:
        item.id,

      image:
        item.image,

      original_image_path:
        item.original_image_path,

      cleaned_image_path:
        item.cleaned_image_path,

      processing_status:
        item.processing_status,
    })
  )
);

  return (
    data ||
    []
  ) as WardrobeItem[];
}

export async function createQueuedWardrobeItem(
  item: {
    image: string;
    category: string;
    subCategory?: string | null;
    name?: string;
    color?: string;
    shade?: string | null;
  }
) {
  const user =
    await getCurrentUser();

  if (!user) {
    throw new Error(
      await getServiceMessage(
        'loginRequired'
      )
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        'wardrobe_items'
      )
      .insert({
        user_id:
          user.id,

        image:
          item.image.trim(),

        category:
          item.category.trim(),

        subCategory:
          item.subCategory
            ?.trim() ||
          null,

        name:
          item.name
            ?.trim() ||
          null,

        color:
          item.color
            ?.trim() ||
          null,

        shade:
          item.shade
            ?.trim() ||
          null,

        favorite:
          false,

        processing_status:
          'queued',

        processing_error:
          null,

        original_image_path:
          item.image.trim(),

        cleaned_image_path:
          null,

        processing_started_at:
          null,

        processing_finished_at:
          null,
      })
      .select('*')
      .single();

  if (error) {
    throw error;
  }

  return data as WardrobeItem;
}

export async function createWardrobeItem(
  item: {
    image: string;

    category: string;

    subCategory?:
      | string
      | null;

    name?: string;

    color?: string;

    shade?:
      | string
      | null;
  }
) {
  const user =
    await getCurrentUser();

  if (!user) {
    throw new Error(
      await getServiceMessage(
        'loginRequired'
      )
    );
  }

  if (
    !item.image ||
    item.image.trim().length ===
      0
  ) {
    throw new Error(
      'The wardrobe image is missing.'
    );
  }

  if (
    !item.category ||
    item.category.trim().length ===
      0
  ) {
    throw new Error(
      'The wardrobe category is missing.'
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        'wardrobe_items'
      )
      .insert({
        user_id:
          user.id,

        image:
          item.image.trim(),

        category:
          item.category.trim(),

        subCategory:
          item.subCategory
            ?.trim() ||
          null,

        name:
          item.name
            ?.trim() ||
          null,

        color:
          item.color
            ?.trim() ||
          null,

        shade:
          item.shade
            ?.trim() ||
          null,

        favorite:
          false,

        /**
         * الصورة خرجت بالفعل من BiRefNet
         * محليًا ورفعت كـ PNG شفاف.
         * لذلك لا تحتاج Queue أو RunPod.
         */
        processing_status:
          'ready',

        processing_error:
          null,

        processing_started_at:
          null,

        processing_finished_at:
          new Date()
            .toISOString(),
      })
      .select('*')
      .single();

  if (error) {
    throw error;
  }

  return data as WardrobeItem;
}

export async function updateWardrobeItem(
  id: string,
  item:
    Partial<WardrobeItem>
) {
  const {
    error,
  } =
    await supabase
      .from(
        'wardrobe_items'
      )
      .update(
        item
      )
      .eq(
        'id',
        id
      );

  if (error) {
    throw error;
  }
}

export async function deleteWardrobeItems(
  ids: string[]
) {
  if (
    ids.length ===
    0
  ) {
    return;
  }

  console.log(
    'SENDING DELETE TO BACKEND:',
    ids
  );

  const session =
    await getAuthenticatedSession();

  const response =
    await fetch(
      `${BACKEND_URL}/wardrobe/items`,
      {
        method:
          'DELETE',

        headers: {
          'Content-Type':
            'application/json',

          Authorization:
            `Bearer ${session.access_token}`,
        },

        body:
          JSON.stringify({
            ids,
          }),
      }
    );

  const result =
    await parseBackendResponse(
      response
    );

  console.log(
    'DELETE BACKEND RESPONSE:',
    response.status,
    result
  );

  if (
    !response.ok ||
    !result.success
  ) {
    await throwBackendError(
      response,
      result,
      'deleteFailed'
    );
  }
}

export async function retryWardrobeItem(
  id: string
) {
  const session =
    await getAuthenticatedSession();

  const response =
    await fetch(
      `${BACKEND_URL}/wardrobe/items/${encodeURIComponent(
        id
      )}/retry`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',

          Authorization:
            `Bearer ${session.access_token}`,
        },
      }
    );

  const result =
    await parseBackendResponse(
      response
    );

  if (
    !response.ok ||
    !result.success
  ) {
    await throwBackendError(
      response,
      result,
      'retryFailed'
    );
  }

  return result.data;
}

export async function cancelWardrobeItem(
  id: string
) {
  const session =
    await getAuthenticatedSession();

  const response =
    await fetch(
      `${BACKEND_URL}/wardrobe/items/${encodeURIComponent(
        id
      )}/cancel`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',

          Authorization:
            `Bearer ${session.access_token}`,
        },
      }
    );

  const result =
    await parseBackendResponse(
      response
    );

  if (
    !response.ok ||
    !result.success
  ) {
    await throwBackendError(
      response,
      result,
      'cancelFailed'
    );
  }

  return result.data;
}

export async function getWardrobeMetrics() {
  const session =
    await getAuthenticatedSession();

  const response =
    await fetch(
      `${BACKEND_URL}/wardrobe/metrics`,
      {
        headers: {
          Authorization:
            `Bearer ${session.access_token}`,
        },
      }
    );

  const result =
    await parseBackendResponse(
      response
    );

  if (
    !response.ok ||
    !result.success
  ) {
    await throwBackendError(
      response,
      result,
      'metricsFailed'
    );
  }

  return result.data;
}

export async function toggleWardrobeFavorite(
  id: string,
  favorite: boolean
) {
  await updateWardrobeItem(
    id,
    {
      favorite,
    }
  );
}