import type { AppWeatherContext } from './appContext';
import type { Outfit } from './outfitRules';
import { colorsMatch } from './outfitRules';

export type AIScoreResult = {
  overall: number;
  color: number;
  weather: number;
  season: number;
  style: number;
  explanation: string[];
};

export function getAIScore(
  outfit: Outfit,
  context?: AppWeatherContext | null,
  occasion?: string
): AIScoreResult {
  let color = 60;
  let weather = 80;
  let season = 80;
  let style = 80;

  const hasBasics = outfit.top && outfit.bottom && outfit.shoes;

  if (colorsMatch(outfit.top?.color, outfit.bottom?.color)) color += 15;
  if (colorsMatch(outfit.bottom?.color, outfit.shoes?.color)) color += 10;
  if (colorsMatch(outfit.top?.color, outfit.shoes?.color)) color += 8;
  if (colorsMatch(outfit.top?.color, outfit.jacket?.color)) color += 5;

  if (hasBasics) style += 8;
  if (outfit.accessory) style += 4;

  if (context) {
    if (context.temperature >= 28 && !outfit.jacket) weather += 15;
    if (context.temperature >= 28 && outfit.jacket) weather -= 20;

    if (context.temperature <= 15 && outfit.jacket) weather += 15;
    if (context.temperature <= 15 && !outfit.jacket) weather -= 20;

    if (context.weather === 'Rainy' && outfit.jacket) weather += 12;
    if (context.weather === 'Rainy' && !outfit.jacket) weather -= 15;

    if (context.season === 'Summer' && !outfit.jacket) season += 15;
    if (context.season === 'Summer' && outfit.jacket) season -= 20;

    if (context.season === 'Winter' && outfit.jacket) season += 15;
    if (context.season === 'Winter' && !outfit.jacket) season -= 15;
  }

  if (occasion === 'Work' && outfit.jacket) style += 6;
  if (occasion === 'Date' && outfit.accessory) style += 6;
  if (occasion === 'Casual') style += 4;

  color = clamp(color);
  weather = clamp(weather);
  season = clamp(season);
  style = clamp(style);

  const overall = Math.round(
    color * 0.3 + weather * 0.25 + season * 0.25 + style * 0.2
  );

  return {
    overall,
    color,
    weather,
    season,
    style,
    explanation: buildExplanation(outfit, context, occasion),
  };
}

function buildExplanation(
  outfit: Outfit,
  context?: AppWeatherContext | null,
  occasion?: string
) {
  const lines: string[] = [];

  if (colorsMatch(outfit.top?.color, outfit.bottom?.color)) {
    lines.push('The top and bottom colors work well together.');
  }

  if (colorsMatch(outfit.bottom?.color, outfit.shoes?.color)) {
    lines.push('The shoes match the lower half of the outfit.');
  }

  if (context?.season === 'Summer' && !outfit.jacket) {
    lines.push('Summer Mode avoided heavy jackets.');
  }

  if (context?.temperature && context.temperature >= 28 && !outfit.jacket) {
    lines.push('No jacket was selected because the weather is hot.');
  }

  if (context?.weather === 'Rainy' && outfit.jacket) {
    lines.push('A jacket was selected because the weather is rainy.');
  }

  if (occasion) {
    lines.push(`This outfit is suitable for ${occasion.toLowerCase()} wear.`);
  }

  if (lines.length === 0) {
    lines.push('This outfit has balanced pieces and a clean style.');
  }

  return lines;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}