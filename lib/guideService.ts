import AsyncStorage from '@react-native-async-storage/async-storage';

const GUIDE_COMPLETED_KEY =
  'TRIPLE_N_GUIDE_COMPLETED';

type GuideCompletionListener =
  (
    completed: boolean
  ) => void;

const listeners =
  new Set<GuideCompletionListener>();

let cachedCompleted:
  boolean | null =
  null;

export async function getGuideCompleted():
  Promise<boolean> {
  if (
    cachedCompleted !==
      null
  ) {
    return cachedCompleted;
  }

  const value =
    await AsyncStorage.getItem(
      GUIDE_COMPLETED_KEY
    );

  cachedCompleted =
    value ===
    'true';

  return cachedCompleted;
}

export async function markGuideCompleted():
  Promise<void> {
  await AsyncStorage.setItem(
    GUIDE_COMPLETED_KEY,
    'true'
  );

  cachedCompleted =
    true;

  for (
    const listener of
    listeners
  ) {
    listener(
      true
    );
  }
}

export function subscribeToGuideCompletion(
  listener:
    GuideCompletionListener
):
  () => void {
  listeners.add(
    listener
  );

  if (
    cachedCompleted !==
      null
  ) {
    listener(
      cachedCompleted
    );
  }

  return () => {
    listeners.delete(
      listener
    );
  };
}