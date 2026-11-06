import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/raise/')({
  beforeLoad: () => {
    throw redirect({ to: '/raise/today' })
  },
})
