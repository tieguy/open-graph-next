import { test } from 'node:test'
import assert from 'node:assert/strict'

import { iaWebpageType, resolveMedia } from '../src/resolve.js'

// --- Internet Archive classification ----------------------------------------

test('an Internet Archive "movies" item is classified as a playable video', () => {
  assert.equal(iaWebpageType({ mediatype: 'movies' }), 'iaVideo')
})

test('an Internet Archive "audio" item is classified as playable audio', () => {
  assert.equal(iaWebpageType({ mediatype: 'audio' }), 'iaAudio')
})

test('an Internet Archive item with no playable embedding stays unclassified', () => {
  // texts (the press kit), images, software, data: the viewer has no IA player
  // for these, so they fall back to the phase-1 caption rather than a broken embed.
  assert.equal(iaWebpageType({ mediatype: 'texts' }), null)
  assert.equal(iaWebpageType({}), null)
  assert.equal(iaWebpageType(null), null)
})

// --- resolveMedia dispatch --------------------------------------------------

test('an IA video resolves to a webpage item the viewer can play from the details URL', () => {
  const item = {
    id: 'ia-apollo11-footage',
    source: 'internet_archive',
    url: 'https://archive.org/details/Apollo11MoonwalkonNASATVJuly201969',
  }
  const media = resolveMedia(item, { iaMetadata: { mediatype: 'movies' } })
  assert.deepEqual(media, {
    type: 'webpage',
    source: 'https://archive.org/details/Apollo11MoonwalkonNASATVJuly201969',
    webpageType: 'iaVideo',
  })
})

test('an IA audio item resolves to an iaAudio webpage', () => {
  const item = {
    id: 'ia-jfk-moon-speech',
    source: 'internet_archive',
    url: 'https://archive.org/details/jfk_rice_moon_speech',
  }
  const media = resolveMedia(item, { iaMetadata: { mediatype: 'audio' } })
  assert.equal(media.type, 'webpage')
  assert.equal(media.webpageType, 'iaAudio')
})

test('an IA item with no playable metadata resolves to nothing, keeping the caption', () => {
  const item = { id: 'ia-nasa-apollo11-press-kit', source: 'internet_archive', url: 'https://archive.org/details/x' }
  assert.equal(resolveMedia(item, { iaMetadata: { mediatype: 'texts' } }), null)
  assert.equal(resolveMedia(item, {}), null)
})

test('a source with no resolver yet resolves to nothing', () => {
  assert.equal(resolveMedia({ id: 'wiki-jfk', source: 'wikipedia', url: 'x' }), null)
})
