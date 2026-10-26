import { describe, it, expect } from 'vitest'
import {
  CalDAVError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  NetworkError
} from '../../../src/caldav/errors'

describe('CalDAV errors', () => {
  it('CalDAVError carries status and response body', () => {
    const error = new CalDAVError('Boom', 500, '<error/>')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('CalDAVError')
    expect(error.message).toBe('Boom')
    expect(error.status).toBe(500)
    expect(error.response).toBe('<error/>')
  })

  it.each([
    [AuthenticationError, 'AuthenticationError', 401, 'Authentication failed'],
    [NotFoundError, 'NotFoundError', 404, 'Resource not found'],
    [ConflictError, 'ConflictError', 412, 'Resource conflict (ETag mismatch)'],
    [NetworkError, 'NetworkError', undefined, 'Network error']
  ])('%o has defaults and is a CalDAVError', (ErrorClass, name, status, message) => {
    const error = new ErrorClass()
    expect(error).toBeInstanceOf(CalDAVError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe(name)
    expect(error.status).toBe(status)
    expect(error.message).toBe(message)
  })

  it('accepts custom messages', () => {
    expect(new NotFoundError('Gone').message).toBe('Gone')
    expect(new AuthenticationError('Token expired').status).toBe(401)
  })

  it('ConflictError keeps the server ETag', () => {
    const error = new ConflictError('Modified', 'etag-1')
    expect(error.serverEtag).toBe('etag-1')
    expect(new ConflictError().serverEtag).toBeUndefined()
  })
})
