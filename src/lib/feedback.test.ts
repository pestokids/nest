import { describe, expect, it } from 'vitest'
import { cleanPath, feedbackTitle, isFeedbackShortcut, issueDescription, pageLabel, viewportLabel } from './feedback'

const key = (o: Partial<KeyboardEvent>) => ({ key: '.', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o })

describe('feedback (PST-289)', () => {
  it('opens on ⌘. and Ctrl+. only', () => {
    expect(isFeedbackShortcut(key({ metaKey: true }))).toBe(true)
    expect(isFeedbackShortcut(key({ ctrlKey: true }))).toBe(true)
    expect(isFeedbackShortcut(key({}))).toBe(false)
    expect(isFeedbackShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false)
    expect(isFeedbackShortcut(key({ metaKey: true, key: 'k' }))).toBe(false)
  })
  it('titles the issue with the first line, cut to fit', () => {
    expect(feedbackTitle('\n  The board jumps  \nwhen a card drops')).toBe('The board jumps')
    const long = feedbackTitle('x'.repeat(300))
    expect(long).toHaveLength(120)
    expect(long.endsWith('…')).toBe(true)
  })
  it('keeps the path and drops the query string', () => {
    expect(cleanPath('/raise/investors?q=someone&sort=priority#top')).toBe('/raise/investors')
    expect(pageLabel('/raise/qanda')).toBe('Raise › Q&A')
    expect(pageLabel('/')).toBe('Home')
    expect(viewportLabel({ w: 1440, h: 900 })).toBe('desktop, 1440 wide')
    expect(viewportLabel({ w: 440, h: 956 })).toBe('phone, 440 wide')
  })
  it('describes the issue with the page, the viewport, the version and the screenshot', () => {
    const d = issueDescription({ type: 'idea', text: 'Show who hasn’t booked yet', path: '/raise/pipeline?x=1', viewport: { w: 1440, h: 900 }, version: 'abc1234' }, 'https://uploads.example.com/shot.png')
    expect(d).toContain('Show who hasn’t booked yet')
    expect(d).toContain('Page: `/raise/pipeline` (Raise › Pipeline)')
    expect(d).toContain('Viewport: 1440 × 900 (desktop, 1440 wide)')
    expect(d).toContain('Version: abc1234')
    expect(d).toContain('![Screenshot of the page](https://uploads.example.com/shot.png)')
    expect(d).not.toContain('x=1')
    expect(issueDescription({ type: 'bug', text: 'x', path: '/', viewport: { w: 1, h: 1 }, version: 'dev' })).not.toContain('Screenshot')
  })
})
