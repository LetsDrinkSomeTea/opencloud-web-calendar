import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { useEvents } from '../../src/composables/useEvents'
import { useErrorMessage } from '../../src/composables/useErrorMessage'
import { NetworkError } from '../../src/caldav/errors'
import { createTestGettext } from './helpers/design-system'
import { messageStore, resetStores } from './helpers/web-pkg'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const fetchAllEvents = vi.fn()
vi.mock('../../src/caldav/client', () => ({
  getCalDAVClient: () => ({ fetchAllEvents })
}))

function withSetup<T>(composable: () => T, language = 'en'): T {
  let result: T
  mount(
    defineComponent({
      setup() {
        result = composable()
        return () => h('div')
      }
    }),
    { global: { plugins: [createTestGettext(language)] } }
  )
  return result
}

const range = { start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) }

beforeEach(() => {
  resetStores()
  fetchAllEvents.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('useErrorMessage', () => {
  it('shows a translated error notification', () => {
    const { showError } = withSetup(() => useErrorMessage(), 'de')
    const err = new NetworkError('offline')
    showError('Failed', err)

    expect(messageStore.messages).toEqual([
      {
        status: 'danger',
        title: 'Failed',
        desc: 'Netzwerkfehler. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
        errors: [err]
      }
    ])
  })

  it('handles non-error values', () => {
    const { showError } = withSetup(() => useErrorMessage())
    showError('Failed', undefined)
    expect(messageStore.messages[0]).toMatchObject({ desc: 'An unexpected error occurred.' })
    expect(messageStore.messages[0]).not.toHaveProperty('errors')
  })
})

describe('useEvents', () => {
  it('reports a failure to load events once until loading succeeds again', async () => {
    const { fetchEvents } = withSetup(() => useEvents())
    fetchAllEvents.mockRejectedValue(new NetworkError('offline'))

    await fetchEvents([], range)
    await fetchEvents([], range)
    expect(messageStore.messages).toHaveLength(1)
    expect(messageStore.messages[0]).toMatchObject({
      status: 'danger',
      title: 'Failed to load events'
    })

    fetchAllEvents.mockResolvedValue([])
    await fetchEvents([], range)
    fetchAllEvents.mockRejectedValue(new NetworkError('offline'))
    await fetchEvents([], range)
    expect(messageStore.messages).toHaveLength(2)
  })
})
