import { createFileRoute } from '@tanstack/react-router'
import { NotFound } from '../../components/system/NotFound'

/** Any path we don't know: "This page flew the nest." inside the shell. */
export const Route = createFileRoute('/_app/$')({ component: NotFound })
