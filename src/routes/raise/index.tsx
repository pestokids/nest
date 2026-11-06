import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/raise/')({
  beforeLoad: () => {
    throw redirect({ to: '/raise/today' })
  },
})
