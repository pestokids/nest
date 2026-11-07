// PST-285: Settings' Wispr Flow card in each ?preview state (&wispr=off|connected|reconnect|fetching), rendered to HTML.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WisprCardView } from './WisprCard'
import { ToastProvider } from '../ui'
import { wisprFixture } from '../../preview/wisprFixture'
import { WISPR_PREVIEW, type WisprCardData } from '../../lib/wispr'

const noop = async () => null
/** A button with this label (the label sits in a span). */
const button = (label: string, attrs = '[^>]*') => new RegExp(`<button${attrs}>(<span[^>]*>)?${label}(</span>)?</button>`)
const render = (data: WisprCardData | null) =>
  renderToString(createElement(ToastProvider, null, createElement(WisprCardView, { data, connect: noop, fetchPast: noop, disconnect: noop })))
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")

describe('Wispr Flow card', () => {
  it('has a preview for every state', () => {
    expect([...WISPR_PREVIEW]).toEqual(['off', 'connected', 'reconnect', 'fetching'])
  })

  it('off: the MCP URL field and Connect', () => {
    const html = render(wisprFixture('off', Date.now()))
    expect(html).toContain('Not connected')
    expect(html).toContain('MCP URL')
    expect(html).toContain('Wispr Flow › Settings › MCP')
    expect(html).toMatch(button('Connect', '[^>]*type="submit"[^>]*'))
    expect(html).not.toContain('Disconnect')
  })

  it('connected: last fetched (time and count), Fetch past 30 days, Disconnect', () => {
    const html = render(wisprFixture('connected', Date.now()))
    expect(html).toContain('>Connected<')
    expect(html).toContain('Last fetched 2 h ago · 3 notes · every 15\u00a0min')
    expect(html).toMatch(button('Fetch past 30 days'))
    expect(html).toContain('Disconnect')
    expect(html).toContain('waits in Suggestions')
  })

  it('fetching: the button waits', () => {
    const html = render(wisprFixture('fetching', Date.now()))
    expect(html).toContain('>Fetching<')
    expect(html).toContain('Fetching notes from the past 30 days…')
    expect(html).toMatch(button('Fetching…', '[^>]*disabled=""[^>]*'))
  })

  it('needs reconnecting: a calm warning and Reconnect', () => {
    const html = render(wisprFixture('reconnect', Date.now()))
    expect(html).toContain('Needs reconnecting')
    expect(html).toContain('set-google__account--warn')
    expect(html).toContain('Reconnect to pick up where it left off')
    expect(html).toMatch(button('Reconnect'))
    expect(html).not.toContain('Fetch past 30 days')
  })

  it('says when Read meeting notes is off, and shows a skeleton while loading', () => {
    expect(render({ ...wisprFixture('connected', Date.now()), reads: false })).toContain('“Read meeting notes” is off')
    expect(render(null)).toContain('aria-busy="true"')
  })
})
