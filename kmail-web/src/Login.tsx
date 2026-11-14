import { useState } from "react";
import { Button, Card, Field, Input, MessageBar, MessageBarBody, Text } from "@fluentui/react-components";
import { api, ApiError } from "./api";

export function Login({ onDone }: { onDone: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onDone((await api.login(email.trim(), password)).email);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(
        code === "bad_credentials" ? "Wrong email address or password."
        : code === "mail_server_unreachable" ? "The mail server is not reachable right now."
        : code === "error" || err instanceof ApiError && err.status === 429 ? "Too many attempts. Wait a minute and try again."
        : "Could not sign in.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", background: "#f3f2f1" }}>
      <Card style={{ width: 360, padding: 28 }}>
        <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
          <Text size={700} weight="semibold" style={{ color: "#0f6cbd" }}>KMail</Text>
          <Text>Sign in with your mailbox address.</Text>
          {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          <Field label="Email address">
            <Input type="email" autoComplete="username" value={email} onChange={(_, d) => setEmail(d.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(_, d) => setPassword(d.value)} required />
          </Field>
          <Button appearance="primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
      </Card>
    </div>
  );
}
