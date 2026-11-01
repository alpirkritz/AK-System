import { describe, expect, it } from 'vitest'
import { isPublicPagePath } from './public-paths'

describe('isPublicPagePath', () => {
  it('allows only /about and /privacy', () => {
    expect(isPublicPagePath('/about')).toBe(true)
    expect(isPublicPagePath('/privacy')).toBe(true)
    expect(isPublicPagePath('/privacy/')).toBe(true)
  })

  it('keeps everything else private', () => {
    expect(isPublicPagePath('/')).toBe(false)
    expect(isPublicPagePath('/tasks')).toBe(false)
    expect(isPublicPagePath('/about/secret')).toBe(false)
    expect(isPublicPagePath('/privacy-settings')).toBe(false)
  })
})
