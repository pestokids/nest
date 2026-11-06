import { Link } from '@tanstack/react-router'
import { buttonClass } from '../ui'
import { NestEmpty } from '../illustrations'

/** 404 (system/404.png): any unknown route, inside the app shell. The leaf sways (3s loop). */
export function NotFound() {
  return (
    <main className="page sys-404">
      <NestEmpty size={236} className="sys-404__illo" />
      <h1 className="sys-404__title">This page flew the nest.</h1>
      <p className="sys-404__sub">The link may be old, or the investor was deleted. Nothing is lost on your side.</p>
      <div className="sys-404__actions">
        <Link to="/" className={buttonClass({ variant: 'primary' })}>
          Back to Home
        </Link>
        <Link to="/raise/today" className={buttonClass({ variant: 'secondary' })}>
          Open Raise
        </Link>
      </div>
      <p className="sys-404__code">404</p>
    </main>
  )
}
