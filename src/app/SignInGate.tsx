import { useEffect, useState, type ReactNode } from "react";
import { checkSignIn, isSignedIn, rememberSignIn, retryDelay } from "./signIn";

/** Shows the app once the device is signed in, else the sign-in screen. */
export function SignInGate({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(isSignedIn);
  return signedIn ? (
    children
  ) : (
    <SignInScreen onSignIn={() => setSignedIn(true)} />
  );
}

function SignInScreen({ onSignIn }: { onSignIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [wrongTries, setWrongTries] = useState(0);
  const [wait, setWait] = useState(0);

  // Count down the wait after a wrong try.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function submit() {
    if (checking || wait > 0) return;
    setChecking(true);
    const ok = await checkSignIn(username, password);
    setChecking(false);
    if (ok) {
      rememberSignIn();
      onSignIn();
      return;
    }
    const tries = wrongTries + 1;
    setWrongTries(tries);
    setWait(retryDelay(tries));
    setPassword("");
  }

  return (
    <main className="sign-in">
      <form
        className="sign-in-card"
        aria-labelledby="sign-in-heading"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <img
          className="sign-in-icon"
          src={`${import.meta.env.BASE_URL}pwa-192x192.png`}
          alt=""
          width={72}
          height={72}
        />
        <h1 id="sign-in-heading">Northrop Hardhat</h1>
        <label className="field">
          <span>Username</span>
          <input
            name="username"
            value={username}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {wrongTries > 0 && (
          <p className="sign-in-error" role="alert">
            That username or password isn&rsquo;t right.
            {wait > 0 && ` Try again in ${wait} s.`}
          </p>
        )}
        <button
          type="submit"
          className="primary"
          disabled={checking || wait > 0 || !username.trim() || !password}
        >
          {checking ? "Checking…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
