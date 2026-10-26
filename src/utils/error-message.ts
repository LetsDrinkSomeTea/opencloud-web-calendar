import type { Language } from 'vue3-gettext'
import {
  AuthenticationError,
  CalDAVError,
  ConflictError,
  NetworkError,
  NotFoundError
} from '../caldav/errors'

type Gettext = Language['$gettext']

/**
 * Returns a translated, user facing message for an error thrown by the CalDAV layer.
 *
 * The CalDAV modules run outside of a component setup context and therefore cannot use
 * `useGettext()`. They throw typed errors instead, which are translated here by the caller
 * (a component or composable) with its own `$gettext`, so the message always follows the
 * current OpenCloud language. Errors without a known type keep their (technical) message.
 */
export function translateError(err: unknown, $gettext: Gettext): string {
  if (err instanceof AuthenticationError) {
    return $gettext('Authentication failed. Please reload the page and sign in again.')
  }
  if (err instanceof NotFoundError) {
    return $gettext('The requested item could not be found. It may have been deleted.')
  }
  if (err instanceof ConflictError) {
    return $gettext('This item was modified by another client. Please reload and try again.')
  }
  if (err instanceof NetworkError) {
    return $gettext('Network error. Please check your connection and try again.')
  }
  if (err instanceof CalDAVError && err.status === 403) {
    return $gettext('You do not have permission to perform this action.')
  }
  if (err instanceof Error && err.message) {
    return err.message
  }
  if (typeof err === 'string' && err) {
    return err
  }
  return $gettext('An unexpected error occurred.')
}
