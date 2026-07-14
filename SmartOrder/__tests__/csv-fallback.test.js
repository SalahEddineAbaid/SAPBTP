'use strict';

const { isRecoverableDbError } = require('../srv/utils/csvFallback');

describe('csvFallback recoverable database errors', () => {
  test.each([
    [{ code: '42P01', message: 'relation "ordersservice_orders" does not exist' }],
    [{ code: '57P01', message: 'terminating connection due to administrator command' }],
    [{ code: 'ECONNRESET', message: 'read ECONNRESET' }],
    [{ statusCode: 503, message: 'Service Unavailable' }],
    [{ message: 'upstream connect error or disconnect/reset before headers. reset reason: connection termination' }],
    [{ message: 'ResourceRequest timed out' }],
  ])('marks transient/incomplete PostgreSQL error as recoverable: %j', (err) => {
    expect(isRecoverableDbError(err)).toBe(true);
  });

  test('does not hide unrelated application errors', () => {
    expect(isRecoverableDbError(new Error('Business validation failed'))).toBe(false);
  });
});
