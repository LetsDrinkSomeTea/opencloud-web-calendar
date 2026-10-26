import { useGettext } from 'vue3-gettext'
import { useMessages } from '@opencloud-eu/web-pkg'
import { translateError } from '../utils/error-message'

/**
 * Shows a failure to the user as an OpenCloud error notification. The description is the
 * translated error message (see `translateError`).
 */
export function useErrorMessage() {
  const { $gettext } = useGettext()
  const messages = useMessages()

  function showError(title: string, err: unknown) {
    messages.showErrorMessage({
      title,
      desc: translateError(err, $gettext),
      ...(err instanceof Error && { errors: [err] })
    })
  }

  return { showError }
}
