// PST-293: where signals start. Notes: each new meeting note tied to an investor
// (pasted, Wispr Flow, an agent, or attached from Unmatched) schedules one Jev call
// in signals.ts when Jev is ready. Emails: the Gmail sync hands over the new
// messages someone else sent; the ones from an investor get one Jev call each,
// on their subject and text (read here once, never stored). When Jev can't answer
// (off, no key, the cap, a failure), nothing changes: the decision stays Dev's.
import type { ActionCtx, MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { askJev, jevReady } from './jev'
import { getMessage, GoogleError, Revoked, type Inbound } from './googleApi'
import { bodyText, emailQuestions, emailState } from '../../src/lib/signals'
import { dayOf } from '../../src/lib/google'

/** A note was added for an investor: read it for signals once Jev is ready. */
export async function noteSignalLater(ctx: MutationCtx, noteId: Id<'notes'>) {
  if (!(await jevReady(ctx))) return
  await ctx.scheduler.runAfter(0, internal.signals.fromNote, { noteId })
}

type Hooks = Parameters<typeof getMessage>[2]

/**
 * After a Gmail sync run: one Jev call per new message from an investor (Dev's
 * own messages, auto-replies and no-reply senders were already left out). The
 * text needs gmail.readonly; under an older gmail.metadata grant Google answers
 * 403 and Jev reads the subject alone (the rest of the run skips the text too). Errors are logged, never thrown.
 */
export async function emailSignals(ctx: ActionCtx, c: { userId: Id<'users'>; googleEmail: string }, token: string, inbound: Inbound[], hooks?: Hooks) {
  if (!inbound.length) return
  try {
    const targets = await ctx.runQuery(internal.signals.emailTargets, {
      userId: c.userId,
      self: c.googleEmail,
      items: inbound.map((m) => ({ messageId: m.messageId, threadId: m.threadId, from: m.from, subject: m.subject, at: m.at })),
    })
    let bodies = true
    let asked = 0
    for (const t of targets) {
      let body = ''
      if (bodies) {
        try {
          body = bodyText((await getMessage(token, t.messageId, hooks)).payload)
        } catch (e) {
          if (e instanceof Revoked || (e instanceof GoogleError && e.status === 403)) bodies = false
        }
      }
      const r = await askJev(ctx, { feature: 'email_signals', state: emailState(t.subject, body), questions: emailQuestions() })
      if (!r) continue
      asked++
      for (const investorId of t.investorIds)
        await ctx.runMutation(internal.signals.save, {
          investorId, source: 'email', key: 'email:' + t.messageId + ':' + investorId, day: dayOf(t.at), messageId: t.messageId,
          ...(t.emailTouchId ? { emailTouchId: t.emailTouchId } : {}), answers: r.answers,
        })
    }
    if (targets.length) console.log('signals email messages=' + targets.length + ' answered=' + asked + ' bodies=' + bodies)
  } catch (e) {
    console.warn('signals email failed: ' + (e instanceof Error ? e.name : 'error'))
  }
}
