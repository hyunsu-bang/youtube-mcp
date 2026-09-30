const maxResultsSchema = {
  type: 'integer',
  description: 'Max results per page (1-50)',
  minimum: 1,
  maximum: 50,
  default: 25
};

export const playlistTools = [
  {
    name: 'list_playlists',
    description: 'List the first page of user playlists as an array. Use list_playlists_page to browse all pages. Requires OAuth.',
    inputSchema: {
      type: 'object',
      properties: { maxResults: maxResultsSchema }
    }
  },
  {
    name: 'list_playlists_page',
    description: 'List one page of user playlists with pagination metadata. Pass nextPageToken as pageToken to continue until nextPageToken is null. Requires OAuth.',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: maxResultsSchema,
        pageToken: {
          type: 'string',
          minLength: 1,
          description: 'Opaque nextPageToken or prevPageToken from a previous response; omit for the first page'
        }
      }
    }
  }
];

export async function listPlaylistsPage(youtube, args = {}) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Arguments must be an object');
  }
  const { maxResults = 25, pageToken } = args;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) {
    throw new Error('maxResults must be an integer between 1 and 50');
  }
  if (pageToken !== undefined && (typeof pageToken !== 'string' || pageToken.length === 0)) {
    throw new Error('pageToken must be a non-empty string');
  }

  const response = await youtube.playlists.list({
    part: ['snippet', 'contentDetails'],
    mine: true,
    maxResults,
    ...(pageToken === undefined ? {} : { pageToken })
  });
  const data = response.data;
  return {
    playlists: (data.items ?? []).map(item => ({
      playlistId: item.id,
      title: item.snippet.title,
      description: item.snippet.description,
      itemCount: item.contentDetails.itemCount
    })),
    nextPageToken: data.nextPageToken ?? null,
    prevPageToken: data.prevPageToken ?? null,
    pageInfo: data.pageInfo ?? null
  };
}

export async function listPlaylists(youtube, args = {}) {
  // Preserve the legacy first-page-only array response and ignore pageToken.
  const page = await listPlaylistsPage(youtube, { maxResults: args.maxResults });
  return page.playlists;
}
