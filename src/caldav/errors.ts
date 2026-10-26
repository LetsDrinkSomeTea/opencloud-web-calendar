export class CalDAVError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly response?: string
  ) {
    super(message)
    this.name = 'CalDAVError'
  }
}

export class AuthenticationError extends CalDAVError {
  constructor(message = 'Authentication failed') {
    super(message, 401)
    this.name = 'AuthenticationError'
  }
}

export class NotFoundError extends CalDAVError {
  constructor(message = 'Resource not found') {
    super(message, 404)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends CalDAVError {
  public readonly serverEtag?: string

  constructor(message = 'Resource conflict (ETag mismatch)', serverEtag?: string) {
    super(message, 412)
    this.name = 'ConflictError'
    this.serverEtag = serverEtag
  }
}

export class NetworkError extends CalDAVError {
  constructor(message = 'Network error') {
    super(message)
    this.name = 'NetworkError'
  }
}

/**
 * The sync token sent with a `sync-collection` REPORT is no longer valid (RFC 6578 3.2,
 * `DAV:valid-sync-token` precondition). The client has to do a full resync.
 */
export class InvalidSyncTokenError extends CalDAVError {
  constructor(message = 'Invalid sync token', status?: number) {
    super(message, status)
    this.name = 'InvalidSyncTokenError'
  }
}
