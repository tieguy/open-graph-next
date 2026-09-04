import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nearMatchTitle } from '../src/wikipedia.js'

const hit = (title) => ({ query: { search: [{ ns: 0, title }] } })

test('a case-folded title resolves to the article enwiki would open', () => {
  assert.equal(nearMatchTitle(hit('Luis Villa'), 'luis villa'), 'Luis Villa')
  assert.equal(nearMatchTitle(hit('Rembrandt'), 'REMBRANDT'), 'Rembrandt')
})

test('no near match means no title', () => {
  assert.equal(nearMatchTitle({ query: { search: [] } }, 'zzqx'), null)
  assert.equal(nearMatchTitle({}, 'zzqx'), null)
})

test('the same title back is not a redirect target', () => {
  // The parse call already failed on this exact title; sending the reader
  // back to it would loop.
  assert.equal(nearMatchTitle(hit('Luis villa'), 'Luis villa'), null)
})

test('a match outside the article namespace is refused', () => {
  assert.equal(nearMatchTitle({ query: { search: [{ ns: 2, title: 'User:Foo' }] } }, 'foo'), null)
})
