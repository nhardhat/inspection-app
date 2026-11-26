import { expect, test } from "vitest";
import { checkSignIn, normaliseUsername, retryDelay } from "./signIn";

// A made-up pair's hash (PBKDF2 as in signIn.ts); the real one stays private.
const TEST_HASH =
  "7e0547465cc343f4c96c1540dab537ddb9b8159a162e0c8223c2c394b5a1f05c";

test("the username ignores capitals and spaces; the password is exact", async () => {
  expect(normaliseUsername("  Test   USER ")).toBe("test user");
  expect(await checkSignIn("test user", "test pass", TEST_HASH)).toBe(true);
  expect(await checkSignIn(" Test User ", "test pass", TEST_HASH)).toBe(true);
  expect(await checkSignIn("test user", "Test pass", TEST_HASH)).toBe(false);
  expect(await checkSignIn("test user", "test pass ", TEST_HASH)).toBe(false);
  expect(await checkSignIn("someone", "test pass", TEST_HASH)).toBe(false);
});

test("the real pair isn't a blank one", async () => {
  expect(await checkSignIn("", "")).toBe(false);
});

test("each wrong try in a row waits longer, up to 30 s", () => {
  expect([0, 1, 2, 3, 4, 5, 6, 9].map(retryDelay)).toEqual([
    0, 1, 2, 4, 8, 16, 30, 30,
  ]);
});
