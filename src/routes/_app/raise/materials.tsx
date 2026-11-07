import { createFileRoute } from '@tanstack/react-router'
import { MaterialsView } from '../../../components/materials/Library'

/** Raise › Materials (PST-282). */
export const Route = createFileRoute('/_app/raise/materials')({ component: MaterialsView })
