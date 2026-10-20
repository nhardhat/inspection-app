import { northrop } from "../../../brand/northrop";
import type { FontKey, MemoAssets } from "./renderMemoPdf";

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Could not load ${url} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Loads fonts and images for the memo. Served from the precache when offline. */
export async function loadMemoAssets(): Promise<MemoAssets> {
  const { fonts, wordmarkCream, icon } = northrop.assets;
  const keys = Object.keys(fonts) as FontKey[];
  const [fontBytes, wordmark, iconBytes] = await Promise.all([
    Promise.all(keys.map((key) => fetchBytes(fonts[key]))),
    fetchBytes(wordmarkCream),
    fetchBytes(icon),
  ]);
  return {
    fonts: Object.fromEntries(
      keys.map((key, i) => [key, fontBytes[i]]),
    ) as Record<FontKey, Uint8Array>,
    wordmarkCream: wordmark,
    icon: iconBytes,
  };
}

/** The memo's assets plus the sidebar pictures, for the Word memo. */
export async function loadWordAssets() {
  const [memo, sidebarFirst, sidebar] = await Promise.all([
    loadMemoAssets(),
    fetchBytes(northrop.assets.sidebarFirst),
    fetchBytes(northrop.assets.sidebar),
  ]);
  return { memo, sidebarFirst, sidebar };
}

/** The red wordmark (the defect register's logo). */
export function loadWordmark(): Promise<Uint8Array> {
  return fetchBytes(northrop.assets.wordmarkRed);
}
