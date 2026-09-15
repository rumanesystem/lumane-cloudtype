import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '../src/api/client';

describe('adminApi saved conversation source', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [false, '/api/admin/conversations/41'],
    [true, '/api/admin/conversations/41?is_test=true'],
  ])('requests the explicit source for isTest=%s', async (isTest, expectedPath) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversation: { id: 41, saved_at: '', messages: [] } }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await adminApi.conversation('41', isTest);

    expect(fetchMock).toHaveBeenCalledWith(expectedPath, expect.objectContaining({ credentials: 'same-origin' }));
  });
});
