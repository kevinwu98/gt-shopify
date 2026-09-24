import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolveSearchResult} from '../app/lib/search.ts';

test('regular search rejection resolves with the query and empty paginated results', async (t) => {
  const failure = new Error('Search service unavailable');
  const log = t.mock.method(console, 'error', () => {});
  const result = await resolveSearchResult(Promise.reject(failure), {
    type: 'regular',
    term: '  blue & green  ',
  });

  assert.deepEqual(result, {
    type: 'regular',
    term: '  blue & green  ',
    error: failure.message,
    result: {
      total: 0,
      items: {
        articles: {nodes: []},
        pages: {nodes: []},
        products: {
          nodes: [],
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
          },
        },
      },
    },
  });
  assert.equal(log.mock.calls[0].arguments[0], failure);
});

test('predictive search rejection preserves the query and all result lists', async (t) => {
  t.mock.method(console, 'error', () => {});
  const result = await resolveSearchResult(Promise.reject(new Error('Unavailable')), {
    type: 'predictive',
    term: 'snowboard',
  });

  assert.equal(result.type, 'predictive');
  assert.equal(result.term, 'snowboard');
  assert.equal(result.error, 'Unavailable');
  assert.deepEqual(result.result, {
    total: 0,
    items: {articles: [], collections: [], products: [], pages: [], queries: []},
  });
});

test('non-Error rejections provide a readable retry message', async (t) => {
  t.mock.method(console, 'error', () => {});
  const result = await resolveSearchResult(Promise.reject(null), {
    type: 'regular',
    term: 'shirt',
  });

  assert.equal(result.error, 'Search is temporarily unavailable. Please try again.');
});

test('successful search results pass through unchanged', async () => {
  const result = {
    type: 'predictive',
    term: 'snowboard',
    result: {
      total: 1,
      items: {articles: [], collections: [], pages: [], products: [], queries: [{text: 'snowboard'}]},
    },
  };

  assert.equal(await resolveSearchResult(Promise.resolve(result), {
    type: 'predictive',
    term: result.term,
  }), result);
});
