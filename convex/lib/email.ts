// Email through the Resend API (PST-282 sends share links; PST-283's Close reuses it).
// RESEND_API_KEY comes from the Convex env. Without it nothing is sent and
// nothing fails: sendEmail resolves { sent: false, reason: 'no-key' }.
// Only from actions (it uses fetch).

export const EMAIL_FROM = 'Dev at Pesto <nest@pestokids.com>'
export const EMAIL_REPLY_TO = 'dev@pestokids.com'
const RESEND_URL = 'https://api.resend.com/emails'

export type Email = { to: string; subject: string; text: string; html?: string }
export type SendResult = { sent: true; id: string } | { sent: false; reason: 'no-key' | 'error'; message?: string }

/** Whether email can be sent here (the UI hides "Send by email" otherwise). */
export const emailReady = () => !!process.env.RESEND_API_KEY?.trim()

/** Send one email. Never throws: a missing key or a refused send comes back as `sent: false`. */
export async function sendEmail({ to, subject, text, html }: Email): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return { sent: false, reason: 'no-key' }
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], reply_to: EMAIL_REPLY_TO, subject, text, ...(html ? { html } : {}) }),
    })
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!res.ok) return { sent: false, reason: 'error', message: body.message ?? `Resend answered ${res.status}` }
    return { sent: true, id: String(body.id ?? '') }
  } catch (e) {
    return { sent: false, reason: 'error', message: e instanceof Error ? e.message : 'Network error' }
  }
}
