import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';

import en, {
    TranslationKey,
} from './en';
import it from './it';

export type AppLanguage =
  | 'English'
  | 'Italian';

type StoredSettings = {
  language?: AppLanguage;
  [key: string]: unknown;
};

type TranslationContextValue = {
  language: AppLanguage;
  loadingLanguage: boolean;

  t: (
    key: TranslationKey
  ) => string;

  changeLanguage: (
    language: AppLanguage
  ) => Promise<void>;

  refreshLanguage:
    () => Promise<void>;
};

const SETTINGS_KEY =
  'TRIPLE_N_SETTINGS';

const TranslationContext =
  createContext<
    TranslationContextValue | undefined
  >(undefined);

function normalizeLanguage(
  value: unknown
): AppLanguage {
  return value === 'Italian'
    ? 'Italian'
    : 'English';
}

async function readStoredSettings(): Promise<StoredSettings> {
  const raw =
    await AsyncStorage.getItem(
      SETTINGS_KEY
    );

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(
      raw
    ) as StoredSettings;
  } catch {
    return {};
  }
}

export function TranslationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [
    language,
    setLanguage,
  ] =
    useState<AppLanguage>(
      'English'
    );

  const [
    loadingLanguage,
    setLoadingLanguage,
  ] = useState(true);

  const refreshLanguage =
    useCallback(async () => {
      try {
        const settings =
          await readStoredSettings();

        setLanguage(
          normalizeLanguage(
            settings.language
          )
        );
      } catch (error) {
        console.warn(
          'LANGUAGE LOAD ERROR:',
          error
        );

        setLanguage(
          'English'
        );
      } finally {
        setLoadingLanguage(
          false
        );
      }
    }, []);

  useEffect(() => {
    void refreshLanguage();
  }, [refreshLanguage]);

  const changeLanguage =
    useCallback(
      async (
        nextLanguage: AppLanguage
      ) => {
        const normalized =
          normalizeLanguage(
            nextLanguage
          );

        setLanguage(
          normalized
        );

        const currentSettings =
          await readStoredSettings();

        await AsyncStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({
            ...currentSettings,
            language:
              normalized,
          })
        );
      },
      []
    );

  const t =
    useCallback(
      (
        key: TranslationKey
      ) => {
        const dictionary =
          language === 'Italian'
            ? it
            : en;

        return (
          dictionary[key] ||
          en[key] ||
          key
        );
      },
      [language]
    );

  const value =
    useMemo(
      () => ({
        language,
        loadingLanguage,
        t,
        changeLanguage,
        refreshLanguage,
      }),
      [
        language,
        loadingLanguage,
        t,
        changeLanguage,
        refreshLanguage,
      ]
    );

  return (
    <TranslationContext.Provider
      value={value}
    >
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  const context =
    useContext(
      TranslationContext
    );

  if (!context) {
    throw new Error(
      'useTranslation must be used inside TranslationProvider'
    );
  }

  return context;
}