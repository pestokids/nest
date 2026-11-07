import { httpRouter } from 'convex/server'
import { auth } from './auth'
import { callback } from './googleOAuth'
import { CALLBACK_PATH } from './lib/googleApi'
import { viewerRoutes } from './viewerHttp'
import { mcpRoutes } from './mcpHttp'

const http = httpRouter()
auth.addHttpRoutes(http)
// PST-263: "Connect Google" (Calendar + Gmail), separate from sign-in.
http.route({ path: CALLBACK_PATH, method: 'GET', handler: callback })
// PST-282: the public viewer at /d/<token> (open, page-time beacons, the PDF).
viewerRoutes(http)
// PST-276: the Nest MCP server at /mcp, and the Nest skill at /mcp/skill.
mcpRoutes(http)
export default http
