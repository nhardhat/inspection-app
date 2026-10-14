/**
 * Developer tools lock (engineer, 2026-10-14): Settings, Developer holds the
 * diagnostics switch and the drawing lab behind a password, so they stay
 * out of engineers' way. Unlocked until the app is closed (or Lock is
 * tapped). Only the password's SHA-256 is here, so it isn't in the code as
 * text; in an app that runs on the device this keeps people out of the way,
 * it isn't security.
 */

const KEY = "hardhat-developer";
const HASH = "0feaf16e57b990418f7bd88e7757e4ff41d200aa926a7bfe092a3173d94a4d70";

export function isDeveloperUnlocked(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Unlocks when the password is right (any letter case); says whether. */
export async function unlockDeveloper(password: string): Promise<boolean> {
  if ((await sha256(password.trim().toUpperCase())) !== HASH) return false;
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage unavailable: unlocked for this screen only.
  }
  return true;
}

export function lockDeveloper() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
}
