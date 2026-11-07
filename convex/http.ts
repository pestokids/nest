import { httpRouter } from 'convex/server'
import { auth } from './auth'
import { callback } from './googleOAuth'
import { CALLBACK_PATH } from './lib/googleApi'

const http = httpRouter()
auth.addHttpRoutes(http)
// PST-263: "Connect Google" (Calendar + Gmail), separate from sign-in.
http.route({ path: CALLBACK_PATH, method: 'GET', handler: callback })
export default http
