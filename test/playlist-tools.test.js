import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listPlaylists, listPlaylistsPage, playlistTools } from '../playlist-tools.js';

const item = {
  id: 'PL-example',
  snippet: { title: 'Favorites', description: 'My videos' },
  contentDetails: { itemCount: 3 }
};
const mappedItem = {
  playlistId: 'PL-example', title: 'Favorites', description: 'My videos', itemCount: 3
};
function mockYoutube(...pages) {
  const calls = [];
  return {
    calls,
    playlists: {
      async list(params) {
        calls.push(params);
        assert.ok(pages.length, 'Unexpected extra API request');
        const data = pages.shift();
        if (data instanceof Error) throw data;
        return { data };
      }
    }
  };
}

test('first page defaults, mapping, metadata, and JSON serialization', async () => {
  const youtube = mockYoutube({
    items: [item], nextPageToken: 'next+/=', pageInfo: { totalResults: 60, resultsPerPage: 25 }
  });
  const page = await listPlaylistsPage(youtube);
  assert.deepEqual(JSON.parse(JSON.stringify(page)), {
    playlists: [mappedItem], nextPageToken: 'next+/=', prevPageToken: null,
    pageInfo: { totalResults: 60, resultsPerPage: 25 }
  });
  assert.deepEqual(youtube.calls, [{ part: ['snippet', 'contentDetails'], mine: true, maxResults: 25 }]);
});

test('walks first, middle, and last pages using unchanged opaque tokens', async () => {
  const token = ' opaque+/=token ';
  const youtube = mockYoutube(
    { items: [item], nextPageToken: token },
    { items: [item], nextPageToken: 'last', prevPageToken: 'first' },
    { items: [], prevPageToken: token, pageInfo: { totalResults: 2, resultsPerPage: 0 } }
  );
  const first = await listPlaylistsPage(youtube, { maxResults: 1 });
  const middle = await listPlaylistsPage(youtube, { maxResults: 1, pageToken: first.nextPageToken });
  const last = await listPlaylistsPage(youtube, { maxResults: 1, pageToken: middle.nextPageToken });
  assert.equal(middle.prevPageToken, 'first');
  assert.deepEqual(last, {
    playlists: [], nextPageToken: null, prevPageToken: token,
    pageInfo: { totalResults: 2, resultsPerPage: 0 }
  });
  assert.equal(youtube.calls.length, 3);
  assert.equal(youtube.calls[1].pageToken, token);
  assert.equal(youtube.calls[2].pageToken, 'last');
});

test('previous-page token is passed through and maximum page size is accepted', async () => {
  const youtube = mockYoutube({ items: [] });
  await listPlaylistsPage(youtube, { maxResults: 50, pageToken: 'previous' });
  assert.equal(youtube.calls[0].maxResults, 50);
  assert.equal(youtube.calls[0].pageToken, 'previous');
});

test('missing items and metadata produce an empty terminal page', async () => {
  assert.deepEqual(await listPlaylistsPage(mockYoutube({}), {}), {
    playlists: [], nextPageToken: null, prevPageToken: null, pageInfo: null
  });
});

test('legacy response remains a first-page array with the same fields and default', async () => {
  const youtube = mockYoutube({ items: [item], nextPageToken: 'unused' });
  assert.deepEqual(await listPlaylists(youtube), [mappedItem]);
  assert.equal(youtube.calls.length, 1);
  assert.equal(youtube.calls[0].maxResults, 25);
  assert.equal('pageToken' in youtube.calls[0], false);
});

test('legacy explicit limit works and does not introduce cursor behavior', async () => {
  const youtube = mockYoutube({ items: [] });
  assert.deepEqual(await listPlaylists(youtube, { maxResults: 50, pageToken: 'ignored' }), []);
  assert.equal(youtube.calls[0].maxResults, 50);
  assert.equal('pageToken' in youtube.calls[0], false);
});

test('invalid limits are rejected before calling the API', async () => {
  for (const value of [0, 51, -1, 1.5, '25', null, NaN, Infinity, true]) {
    for (const list of [listPlaylists, listPlaylistsPage]) {
      const youtube = mockYoutube();
      await assert.rejects(list(youtube, { maxResults: value }), /maxResults must be an integer between 1 and 50/);
      assert.equal(youtube.calls.length, 0);
    }
  }
});

test('invalid tokens and argument containers are rejected before calling the API', async () => {
  for (const args of [{ pageToken: '' }, { pageToken: null }, { pageToken: 1 }, { pageToken: [] }, null, [], 'bad', 1]) {
    const youtube = mockYoutube();
    await assert.rejects(listPlaylistsPage(youtube, args), /pageToken must be a non-empty string|Arguments must be an object/);
    assert.equal(youtube.calls.length, 0);
  }
});

test('API failures propagate to the existing MCP error handler without retrying', async () => {
  for (const list of [listPlaylists, listPlaylistsPage]) {
    const error = new Error('YouTube quota exceeded');
    const youtube = mockYoutube(error);
    await assert.rejects(list(youtube, {}), error);
    assert.equal(youtube.calls.length, 1);
  }
});

test('tool discovery schemas and desktop extension manifest include the new tool', async () => {
  const [legacy, paginated] = playlistTools;
  assert.equal(legacy.name, 'list_playlists');
  assert.equal(paginated.name, 'list_playlists_page');
  assert.equal(legacy.inputSchema.properties.pageToken, undefined);
  assert.deepEqual(paginated.inputSchema.properties.maxResults, {
    type: 'integer', description: 'Max results per page (1-50)', minimum: 1, maximum: 50, default: 25
  });
  assert.equal(paginated.inputSchema.properties.pageToken.type, 'string');
  assert.equal(paginated.inputSchema.properties.pageToken.minLength, 1);
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.tools.filter(tool => tool.name === paginated.name).length, 1);
});
