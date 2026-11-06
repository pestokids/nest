export function SignIn({ onSignIn, denied, busy }: { onSignIn?: () => void; denied?: boolean; busy?: boolean }) {
  return (
    <div className="wrap">
      <section className="signin">
        <div className="eyebrow">Pesto · Nest</div>
        <h1>Sign in</h1>
        {denied ? (
          <div className="notice" role="alert">
            This account doesn’t have access.
          </div>
        ) : null}
        <p className="muted" style={{ margin: 0 }}>
          Use your pestokids.com Google account.
        </p>
        <button className="btn primary" type="button" onClick={onSignIn} disabled={busy || !onSignIn}>
          {busy ? 'Checking…' : 'Sign in with Google'}
        </button>
      </section>
    </div>
  )
}
