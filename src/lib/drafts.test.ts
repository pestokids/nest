// PST-278: Drafts, the pure parts. Every name and address is made up.
import { describe, expect, it } from 'vitest'
import { blanks, draftTitle, firstLine, mainContact, normBlanks, pathNames, pickType, recipientFor, stripFiller, warmPathContact, whatsappUrl } from './drafts'

describe('the type the drawer picks', () => {
  it('follows the stage', () => {
    expect(pickType('todo')).toBe('intro')
    expect(pickType('ask')).toBe('intro')
    expect(pickType('intro')).toBe('intro')
    expect(pickType('booked')).toBe('followup')
    expect(pickType('m1')).toBe('followup')
    expect(pickType('m2')).toBe('followup')
    expect(pickType('dd')).toBe('followup')
    expect(pickType('verbal')).toBe('thanks')
    expect(pickType('signed')).toBe('thanks')
    expect(pickType('wired')).toBe('thanks')
  })
  it('and the history: gone quiet after a meeting is a nudge', () => {
    expect(pickType('m1', { quiet: true })).toBe('nudge')
    expect(pickType('booked', { quiet: true })).toBe('nudge')
    expect(pickType('parked')).toBe('nudge')
    expect(pickType('intro', { quiet: true })).toBe('intro')
    expect(pickType('verbal', { quiet: true })).toBe('thanks')
  })
})

describe('who it goes to', () => {
  const ria = { email: 'ria.menon@orbit.example.com', name: 'Ria Menon', at: 100 }
  it('the warm-path person the path names, from Gmail or Calendar', () => {
    expect(pathNames('Ria (angel), Kabir Shah / Mira')).toEqual([['ria'], ['kabir', 'shah'], ['mira']])
    expect(warmPathContact('Ria', [ria])).toEqual({ name: 'Ria Menon', email: 'ria.menon@orbit.example.com' })
    expect(warmPathContact('Ria Menon (operator)', [ria])).toEqual({ name: 'Ria Menon', email: 'ria.menon@orbit.example.com' })
    // A Gmail participant has no display name: the name comes from the address.
    expect(warmPathContact('Kabir', [{ email: 'kabir.shah@tallgrass.example.com', at: 5 }])).toEqual({ name: 'Kabir Shah', email: 'kabir.shah@tallgrass.example.com' })
  })
  it('nobody when the path names no one Nest has seen', () => {
    expect(warmPathContact('Direct', [ria])).toBeNull()
    expect(warmPathContact('Ria Kapoor', [ria])).toBeNull()
    expect(warmPathContact('', [ria])).toBeNull()
  })
  it('the most recent match, never one of us or the investor themselves', () => {
    const older = { email: 'ria@oldco.example.com', name: 'Ria Menon', at: 10 }
    expect(warmPathContact('Ria', [older, ria])?.email).toBe('ria.menon@orbit.example.com')
    expect(warmPathContact('Ria', [{ email: 'ria@pestokids.com', name: 'Ria', at: 999 }, older])?.email).toBe('ria@oldco.example.com')
    expect(warmPathContact('Ria', [ria], { exclude: ['RIA.MENON@orbit.example.com'] })).toBeNull()
    expect(warmPathContact('Ria', [ria], { excludeDomains: ['orbit.example.com'] })).toBeNull()
  })
  it('the main contact: the primary person with an email, else the investor’s email', () => {
    const people = [{ name: 'Rhea Lal', email: 'rhea@kite.example.com', primary: false }, { name: 'Sam Kapoor', email: 'Sam@Kite.example.com', primary: true }]
    expect(mainContact(people, 'hello@kite.example.com')).toEqual({ name: 'Sam Kapoor', email: 'sam@kite.example.com' })
    expect(mainContact([{ name: 'Sam Kapoor', primary: true }], 'hello@kite.example.com')).toEqual({ email: 'hello@kite.example.com' })
    expect(mainContact([], undefined)).toBeNull()
  })
  it('an intro ask goes to the warm path, or to nobody (a blurb to forward)', () => {
    const contact = { name: 'Sam Kapoor', email: 'sam@kite.example.com' }
    const warm = { name: 'Ria Menon', email: 'ria.menon@orbit.example.com' }
    expect(recipientFor('intro', contact, warm)).toBe(warm)
    expect(recipientFor('intro', contact, null)).toBeNull()
    expect(recipientFor('nudge', contact, warm)).toBe(contact)
    expect(draftTitle('intro', 'Kite Angels', warm)).toBe('Ask Ria for an intro to Kite Angels')
    expect(draftTitle('intro', 'Kite Angels', null)).toBe('Intro blurb for Kite Angels')
  })
})

describe('the text', () => {
  it('keeps blanks as [__] and counts them', () => {
    expect(normBlanks('up [ __ ]% from [___]% and [__]')).toBe('up [__]% from [__]% and [__]')
    expect(normBlanks('a [link] stays')).toBe('a [link] stays')
    expect(blanks('Retention [__]% from [__]%')).toBe(2)
    expect(blanks('No numbers')).toBe(0)
  })
  it('drops filler openers', () => {
    expect(stripFiller('Hi Sam,\n\nI hope this finds you well.\nThanks for Friday.')).toBe('Hi Sam,\n\nThanks for Friday.')
    expect(stripFiller('Hi Sam, I hope you’re doing well! Quick one.')).toBe('Hi Sam, Quick one.')
  })
  it('the first line that says something', () => {
    expect(firstLine('Hi Sam,\n\nThanks again for Friday.\n\nDev')).toBe('Thanks again for Friday.')
    expect(firstLine('Quick one: are you free Tuesday?')).toBe('Quick one: are you free Tuesday?')
  })
  it('a WhatsApp link with the text', () => {
    expect(whatsappUrl('Hi Sam & co\nDev')).toBe('https://wa.me/?text=Hi%20Sam%20%26%20co%0ADev')
  })
})
