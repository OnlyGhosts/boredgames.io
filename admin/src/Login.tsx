import { Wordmark } from '../../client/src/platform/components/Wordmark';
import { useState, type FormEvent } from 'react';
import type { LoginError } from './api';

function errorText(error: LoginError): string {
  switch (error.kind) {
    case 'wrong':
      return 'Wrong password';
    case 'wait':
      return `Too many tries, wait ${error.seconds} ${error.seconds === 1 ? 'second' : 'seconds'}`;
    case 'setup':
      return 'The admin password is not set up yet.';
    case 'network':
      return 'Could not reach the server. Try again.';
  }
}

interface Props {
  error: LoginError | null;
  busy: boolean;
  onSubmit(password: string): void;
}

export function LoginView({ error, busy, onSubmit }: Props) {
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) onSubmit(password);
  };
  return (
    <main className="login">
      <form className="card login__card" onSubmit={submit} data-testid="admin-login">
        <h1 className="login__title">
          <Wordmark />
          <span className="login__tag">admin</span>
        </h1>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="input"
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            data-testid="admin-password"
          />
        </label>
        {error && (
          <p className="field__error" id="login-error" role="alert" data-testid="admin-login-error">
            {errorText(error)}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy || !password} data-testid="admin-sign-in">
          {busy ? 'Signing in' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
