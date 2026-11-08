// PST-289: the Linear calls behind Send feedback. Linear's GraphQL API with a
// personal API key (LINEAR_API_KEY, sent as-is in Authorization). Every call is
// one POST; errors become LinearError with Linear's message, never the key.
export const LINEAR_API = 'https://api.linear.app/graphql'
export const LINEAR_TEAM = 'Pesto'
export const LINEAR_PROJECT = 'Nest'
export const LINEAR_LABEL = 'Feedback'

export class LinearError extends Error {}

async function gql<T>(key: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(LINEAR_API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: key }, body: JSON.stringify({ query, variables }) })
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message?: string }[] } | null
  const why = body?.errors?.[0]?.message
  if (!res.ok || !body?.data || why) throw new LinearError(`Linear answered ${res.status}${why ? `: ${why}` : ''}`.slice(0, 300))
  return body.data
}

type Target = { teamId: string; projectId: string; labelId: string }

const TARGET = `query Target($team: String!, $project: String!, $label: String!) {
  teams(filter: { name: { eq: $team } }) { nodes { id } }
  projects(filter: { name: { eq: $project } }) { nodes { id } }
  issueLabels(filter: { name: { eqIgnoreCase: $label } }) { nodes { id team { id } } }
}`

const CREATE_LABEL = `mutation Label($teamId: String!, $name: String!) {
  issueLabelCreate(input: { teamId: $teamId, name: $name }) { success issueLabel { id } }
}`

/** Pesto's team, the Nest project and the Feedback label (made on the team when it's missing). */
export async function linearTarget(key: string): Promise<Target> {
  const d = await gql<{ teams: { nodes: { id: string }[] }; projects: { nodes: { id: string }[] }; issueLabels: { nodes: { id: string; team: { id: string } | null }[] } }>(key, TARGET, {
    team: LINEAR_TEAM,
    project: LINEAR_PROJECT,
    label: LINEAR_LABEL,
  })
  const teamId = d.teams.nodes[0]?.id
  const projectId = d.projects.nodes[0]?.id
  if (!teamId) throw new LinearError(`No team called ${LINEAR_TEAM} in Linear`)
  if (!projectId) throw new LinearError(`No project called ${LINEAR_PROJECT} in Linear`)
  const label = d.issueLabels.nodes.find((l) => l.team?.id === teamId) ?? d.issueLabels.nodes.find((l) => !l.team)
  if (label) return { teamId, projectId, labelId: label.id }
  const made = await gql<{ issueLabelCreate: { success: boolean; issueLabel: { id: string } | null } }>(key, CREATE_LABEL, { teamId, name: LINEAR_LABEL })
  if (!made.issueLabelCreate.success || !made.issueLabelCreate.issueLabel) throw new LinearError(`Couldn’t make the ${LINEAR_LABEL} label`)
  return { teamId, projectId, labelId: made.issueLabelCreate.issueLabel.id }
}

const FILE_UPLOAD = `mutation Upload($contentType: String!, $filename: String!, $size: Int!) {
  fileUpload(contentType: $contentType, filename: $filename, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } }
}`

/** Linear's fileUpload flow: ask for a signed URL, PUT the bytes there, and use the asset URL in markdown. */
export async function uploadToLinear(key: string, file: Blob, filename: string): Promise<string> {
  const contentType = file.type || 'image/png'
  const d = await gql<{ fileUpload: { success: boolean; uploadFile: { uploadUrl: string; assetUrl: string; headers: { key: string; value: string }[] } | null } }>(key, FILE_UPLOAD, {
    contentType,
    filename,
    size: file.size,
  })
  const up = d.fileUpload.uploadFile
  if (!d.fileUpload.success || !up) throw new LinearError('Linear didn’t give an upload URL')
  const headers = new Headers({ 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000' })
  for (const h of up.headers) headers.set(h.key, h.value)
  const put = await fetch(up.uploadUrl, { method: 'PUT', headers, body: file })
  if (!put.ok) throw new LinearError(`The screenshot upload failed (${put.status})`)
  return up.assetUrl
}

const CREATE_ISSUE = `mutation Issue($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier url } }
}`

/** One feedback issue in Pesto › Nest, labelled Feedback. `description` gets the screenshot's URL once it's up. */
export async function createFeedbackIssue(key: string, f: { title: string; description: (screenshotUrl?: string) => string; screenshot?: Blob | null }) {
  const target = await linearTarget(key)
  const shot = f.screenshot ? await uploadToLinear(key, f.screenshot, 'nest-feedback.png') : undefined
  const d = await gql<{ issueCreate: { success: boolean; issue: { identifier: string; url: string } | null } }>(key, CREATE_ISSUE, {
    input: { teamId: target.teamId, projectId: target.projectId, labelIds: [target.labelId], title: f.title, description: f.description(shot) },
  })
  if (!d.issueCreate.success || !d.issueCreate.issue) throw new LinearError('Linear didn’t make the issue')
  return d.issueCreate.issue
}
