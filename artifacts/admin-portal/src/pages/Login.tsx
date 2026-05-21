import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "@/lib/api";
import { setSession, type AdminUser } from "@/lib/auth";

interface LoginResponse {
  token: string;
  user: AdminUser;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiPost<LoginResponse>("/auth/login", { email, password });
      if (res.user.role !== "admin") {
        setError("This account does not have admin access.");
        return;
      }
      setSession(res.token, res.user);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h2>Admin sign in</h2>
        <p>Restricted to authorized Project Alpha operators.</p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <div className="error-text">{error}</div>}

        <button type="submit" className="btn primary full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
