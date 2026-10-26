import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, isProxy, nextTick, ref, type PropType } from 'vue'
import type { Modal } from '@opencloud-eu/web-pkg'
import { useModalBinding } from '../../src/composables/useModalBinding'
import { modalStore, resetStores } from './helpers/web-pkg'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const Content = defineComponent({
  props: { modal: { type: Object as PropType<Modal>, required: true } },
  render: () => h('div')
})

function mountBinding(open = ref(false), title = ref('Title')) {
  const onCancel = vi.fn()
  const wrapper = mount(
    defineComponent({
      setup() {
        useModalBinding({
          open,
          title: () => title.value,
          modal: () => ({ customComponent: Content, hideConfirmButton: true, onCancel })
        })
        return () => h('div')
      }
    })
  )
  return { wrapper, open, title, onCancel }
}

beforeEach(() => {
  resetStores()
})

describe('useModalBinding', () => {
  it('dispatches the modal when opened and removes it when closed', async () => {
    const { open } = mountBinding()
    expect(modalStore.modals).toHaveLength(0)

    open.value = true
    await nextTick()
    expect(modalStore.modals).toHaveLength(1)
    expect(modalStore.modals[0]).toMatchObject({ title: 'Title', hideConfirmButton: true })

    open.value = false
    await nextTick()
    expect(modalStore.modals).toHaveLength(0)
  })

  it('dispatches immediately when already open', () => {
    mountBinding(ref(true))
    expect(modalStore.modals).toHaveLength(1)
  })

  it('does not make the custom component reactive', async () => {
    mountBinding(ref(true))
    expect(isProxy(modalStore.modals[0].customComponent)).toBe(false)
  })

  it('keeps the title in sync', async () => {
    const { title } = mountBinding(ref(true))
    title.value = 'Titel'
    await nextTick()
    expect(modalStore.modals[0].title).toBe('Titel')
  })

  it('dispatches again after the modal was closed from the outside', async () => {
    const { open } = mountBinding(ref(true))
    // e.g. ESC: the wrapper calls onCancel and removes the modal
    modalStore.removeModal(modalStore.modals[0].id)
    open.value = false
    await nextTick()

    open.value = true
    await nextTick()
    expect(modalStore.modals).toHaveLength(1)
  })

  it('removes the modal when the host unmounts', () => {
    const { wrapper } = mountBinding(ref(true))
    wrapper.unmount()
    expect(modalStore.modals).toHaveLength(0)
  })
})
