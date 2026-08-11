import AsyncStorage from '@react-native-async-storage/async-storage';

export type Season =
  | 'Winter'
  | 'Spring'
  | 'Summer'
  | 'Autumn';

export type TemperatureUnit =
  | '°C'
  | '°F';

export type AppWeatherContext = {
  season: Season;

  temperature: number;

  weather: string;
};

type SavedSettings = {
  temperature?:
    TemperatureUnit;
};

export type SeasonTranslationKey =
  | 'weatherContext.season.winter'
  | 'weatherContext.season.spring'
  | 'weatherContext.season.summer'
  | 'weatherContext.season.autumn';

export type WeatherTranslationKey =
  | 'weatherContext.weather.sunny'
  | 'weatherContext.weather.cold'
  | 'weatherContext.weather.fresh'
  | 'weatherContext.weather.cloudy'
  | 'weatherContext.weather.hot'
  | 'weatherContext.weather.mild'
  | 'weatherContext.weather.rainy'
  | 'weatherContext.weather.unknown';

const WEATHER_CONTEXT_KEY =
  'appWeatherContext';

const SETTINGS_KEY =
  'TRIPLE_N_SETTINGS';

export function getCurrentSeason(): Season {
  const month =
    new Date().getMonth() +
    1;

  if (
    month === 12 ||
    month === 1 ||
    month === 2
  ) {
    return 'Winter';
  }

  if (
    month >= 3 &&
    month <= 5
  ) {
    return 'Spring';
  }

  if (
    month >= 6 &&
    month <= 8
  ) {
    return 'Summer';
  }

  return 'Autumn';
}

export function getDefaultWeatherContext(): AppWeatherContext {
  const season =
    getCurrentSeason();

  if (
    season ===
    'Summer'
  ) {
    return {
      season,

      temperature:
        32,

      weather:
        'Sunny',
    };
  }

  if (
    season ===
    'Winter'
  ) {
    return {
      season,

      temperature:
        8,

      weather:
        'Cold',
    };
  }

  if (
    season ===
    'Spring'
  ) {
    return {
      season,

      temperature:
        20,

      weather:
        'Fresh',
    };
  }

  return {
    season,

    temperature:
      16,

    weather:
      'Cloudy',
  };
}

export function getSeasonTranslationKey(
  season: Season
): SeasonTranslationKey {
  switch (season) {
    case 'Winter':
      return 'weatherContext.season.winter';

    case 'Spring':
      return 'weatherContext.season.spring';

    case 'Summer':
      return 'weatherContext.season.summer';

    case 'Autumn':
    default:
      return 'weatherContext.season.autumn';
  }
}

export function getWeatherTranslationKey(
  weather:
    | string
    | null
    | undefined
): WeatherTranslationKey {
  const normalizedWeather =
    String(
      weather || ''
    )
      .trim()
      .toLowerCase();

  switch (
    normalizedWeather
  ) {
    case 'sunny':
      return 'weatherContext.weather.sunny';

    case 'cold':
      return 'weatherContext.weather.cold';

    case 'fresh':
      return 'weatherContext.weather.fresh';

    case 'cloudy':
      return 'weatherContext.weather.cloudy';

    case 'hot':
      return 'weatherContext.weather.hot';

    case 'mild':
      return 'weatherContext.weather.mild';

    case 'rainy':
      return 'weatherContext.weather.rainy';

    default:
      return 'weatherContext.weather.unknown';
  }
}

export async function saveWeatherContext(
  context:
    AppWeatherContext
) {
  await AsyncStorage.setItem(
    WEATHER_CONTEXT_KEY,

    JSON.stringify(
      context
    )
  );
}

export async function loadWeatherContext(): Promise<AppWeatherContext> {
  try {
    const saved =
      await AsyncStorage.getItem(
        WEATHER_CONTEXT_KEY
      );

    if (saved) {
      const parsed =
        JSON.parse(
          saved
        ) as AppWeatherContext;

      if (
        parsed &&
        typeof parsed.temperature ===
          'number' &&
        typeof parsed.weather ===
          'string' &&
        isSeason(
          parsed.season
        )
      ) {
        return parsed;
      }

      await AsyncStorage.removeItem(
        WEATHER_CONTEXT_KEY
      );
    }
  } catch {
    await AsyncStorage.removeItem(
      WEATHER_CONTEXT_KEY
    );
  }

  const defaultContext =
    getDefaultWeatherContext();

  await saveWeatherContext(
    defaultContext
  );

  return defaultContext;
}

export async function loadTemperatureUnit(): Promise<TemperatureUnit> {
  try {
    const savedSettings =
      await AsyncStorage.getItem(
        SETTINGS_KEY
      );

    if (!savedSettings) {
      return '°C';
    }

    const settings =
      JSON.parse(
        savedSettings
      ) as SavedSettings;

    return settings.temperature ===
      '°F'
      ? '°F'
      : '°C';
  } catch {
    return '°C';
  }
}

export function convertTemperature(
  celsius: number,
  unit:
    TemperatureUnit
): number {
  if (
    unit ===
    '°F'
  ) {
    return Math.round(
      (
        celsius *
        9
      ) /
        5 +
        32
    );
  }

  return Math.round(
    celsius
  );
}

export function formatTemperature(
  celsius: number,
  unit:
    TemperatureUnit
): string {
  const converted =
    convertTemperature(
      celsius,
      unit
    );

  return `${converted}${unit}`;
}

export async function getFormattedTemperature(
  celsius: number
): Promise<string> {
  const unit =
    await loadTemperatureUnit();

  return formatTemperature(
    celsius,
    unit
  );
}

function isSeason(
  value: unknown
): value is Season {
  return (
    value ===
      'Winter' ||
    value ===
      'Spring' ||
    value ===
      'Summer' ||
    value ===
      'Autumn'
  );
}