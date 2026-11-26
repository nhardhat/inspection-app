/**
 * Local sign-in (engineer, 2026-11-27): the app asks for a username and
 * password before anything else, so someone who finds the link can't make
 * Northrop memos. Checked on the device (works offline); a device stays
 * signed in until Sign out. The username ignores capitals and extra spaces;
 * the password is exact.
 *
 * Only a slow PBKDF2 hash of the pair is here, never the text, so it can't
 * be read from the public code or quickly guessed from the hash. It keeps
 * casual visitors out; it isn't server-grade security (the app has no
 * server). Never write the username or password in the repo or docs.
 */

const KEY = "hardhat-signed-in";
const SALT = "northrop-hardhat-sign-in-v1";
const ITERATIONS = 600_000;
const HASH = "354a703ed52dd1dc86633bad5b2fce3e80eb4841cc1e57e3c9a04ebc74f43f08";

/** The username as compared: lower case, single spaces, trimmed. */
export function normaliseUsername(username: string): string {
  return username.trim().replace(/\s+/g, " ").toLowerCase();
}

async function pbkdf2(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(text),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(SALT),
      iterations: ITERATIONS,
    },
    key,
    256,
  );
  return [...new Uint8Array(bits)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Whether the username and password are right (`expected`: tests only). */
export async function checkSignIn(
  username: string,
  password: string,
  expected = HASH,
): Promise<boolean> {
  return (
    (await pbkdf2(`${normaliseUsername(username)}\n${password}`)) === expected
  );
}

export function isSignedIn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberSignIn() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Storage unavailable: signed in until the app closes.
  }
}

export function signOut() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
}

/** Seconds to wait after the nth wrong try in a row (1, 2, 4 … up to 30). */
export function retryDelay(wrongTries: number): number {
  return wrongTries <= 0 ? 0 : Math.min(30, 2 ** (wrongTries - 1));
}
