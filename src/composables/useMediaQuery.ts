import { onBeforeUnmount, ref, type Ref } from 'vue'

/** Tailwind's `sm` breakpoint, where the sidebar stops being an off-canvas drawer */
export const SM_BREAKPOINT_QUERY = '(min-width: 640px)'

/** Reactive `window.matchMedia(query).matches`; `false` where `matchMedia` is unavailable */
export function useMediaQuery(query: string): Ref<boolean> {
  const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null
  const matches = ref(mql?.matches ?? false)

  if (mql) {
    const onChange = (event: MediaQueryListEvent) => {
      matches.value = event.matches
    }
    mql.addEventListener('change', onChange)
    onBeforeUnmount(() => mql.removeEventListener('change', onChange))
  }

  return matches
}
