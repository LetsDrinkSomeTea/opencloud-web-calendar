import { reactive } from 'vue'
import { useClientService } from '@opencloud-eu/web-pkg'
import type { User } from '@opencloud-eu/web-client/graph/generated'
import { getCalDAVBasePath } from '../config'

const userProfiles = reactive<Record<string, string>>({})

const USER_SELECT: Array<'id' | 'displayName' | 'mail' | 'onPremisesSamAccountName'> = [
  'id',
  'displayName',
  'mail',
  'onPremisesSamAccountName'
]

function getDisplayName(user: User, fallback: string): string {
  return user.displayName || user.onPremisesSamAccountName || fallback
}

// Graph `$search` expects the term to be quoted
function quoteSearchTerm(term: string): string {
  return `"${term.replace(/"/g, '')}"`
}

export function cleanUserId(id: string): string {
  if (!id) return id
  // If it's a URL or path, get the last segment
  if (id.includes('/')) {
    // For principal URLs like /caldav/user/ we want the segment after the CalDAV base path
    const base = getCalDAVBasePath()
    if (id.startsWith(`${base}/`)) {
      const [first] = id.slice(base.length).split('/').filter(Boolean)
      if (first) return first
    }
    const segments = id.split('/').filter(Boolean)
    return segments.pop() || id
  }
  return id
}

export function useUserProfiles() {
  const clientService = useClientService()

  async function loadUserProfile(userId: string): Promise<string> {
    const cleanedId = cleanUserId(userId)
    if (userProfiles[cleanedId]) return userProfiles[cleanedId]
    if (userProfiles[userId]) return userProfiles[userId]

    const graph = clientService.graphAuthenticated

    try {
      // Try direct ID lookup first
      const user = await graph.users.getUser(cleanedId)
      const name = getDisplayName(user, cleanedId)
      userProfiles[cleanedId] = name
      userProfiles[userId] = name
      return name
    } catch {
      // Not a user id, fall back to search below
    }

    try {
      // Fallback: search by ID/username
      const users = await graph.users.listUsers({
        search: quoteSearchTerm(cleanedId),
        select: USER_SELECT
      })
      const user =
        users.find(
          (u) =>
            u.id === cleanedId || u.onPremisesSamAccountName === cleanedId || u.mail === cleanedId
        ) || users[0]
      if (user) {
        const name = getDisplayName(user, cleanedId)
        userProfiles[cleanedId] = name
        userProfiles[userId] = name
        return name
      }
    } catch {
      // Silently fail and use the id
    }
    return cleanedId
  }

  async function resolveUser(userIdOrEmail: string): Promise<string> {
    // If it already looks like a UUID, just return it
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userIdOrEmail)) {
      return userIdOrEmail
    }

    let users: User[]
    try {
      users = await clientService.graphAuthenticated.users.listUsers({
        search: quoteSearchTerm(userIdOrEmail),
        select: USER_SELECT
      })
    } catch (e) {
      throw new Error(`Failed to lookup user: ${e instanceof Error ? e.message : String(e)}`)
    }

    // Try to find exact match on username or mail
    const exactMatch = users.find(
      (u) =>
        u.onPremisesSamAccountName === userIdOrEmail ||
        u.mail === userIdOrEmail ||
        u.displayName === userIdOrEmail
    )

    const match = exactMatch?.id ? exactMatch : users[0]
    if (match?.id) {
      userProfiles[match.id] = getDisplayName(match, match.id)
      return match.id
    }

    throw new Error(`User not found: ${userIdOrEmail}`)
  }

  return {
    userProfiles,
    loadUserProfile,
    resolveUser,
    cleanUserId
  }
}
