// GitHub Discussions GraphQL tools.
// Pure functions over GitHub client.graphql.

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required (pass "repository": "owner/repo" or set defaults in settings)')
  }
}

/** List discussions for a repository. */
export async function listDiscussions(client, { owner, repo, categoryId, limit = 20 } = {}) {
  ensureRepo({ owner, repo })
  const perPage = Math.max(1, Math.min(Number(limit) || 20, 50))

  const query = `
    query ListDiscussions($owner: String!, $repo: String!, $first: Int!, $categoryId: ID) {
      repository(owner: $owner, name: $repo) {
        discussions(first: $first, categoryId: $categoryId, orderBy: {field: CREATED_AT, direction: DESC}) {
          totalCount
          nodes {
            id
            number
            title
            url
            createdAt
            upvoteCount
            author {
              login
            }
            category {
              id
              name
              emoji
            }
            comments {
              totalCount
            }
          }
        }
      }
    }
  `

  const data = await client.graphql(query, {
    owner,
    repo,
    first: perPage,
    categoryId: categoryId || null,
  })

  const conn = data?.repository?.discussions
  const nodes = Array.isArray(conn?.nodes) ? conn.nodes : []

  return {
    totalCount: typeof conn?.totalCount === 'number' ? conn.totalCount : nodes.length,
    discussions: nodes.map((d) => ({
      id: d.id,
      number: d.number,
      title: d.title,
      url: d.url,
      createdAt: d.createdAt,
      upvoteCount: d.upvoteCount || 0,
      author: d.author?.login || 'ghost',
      category: d.category ? { id: d.category.id, name: d.category.name, emoji: d.category.emoji } : null,
      commentsCount: d.comments?.totalCount || 0,
    })),
  }
}

/** View discussion details and comments by number. */
export async function getDiscussion(client, { owner, repo, number } = {}) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('discussion number is required')

  const query = `
    query GetDiscussion($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          id
          number
          title
          body
          url
          createdAt
          upvoteCount
          author {
            login
          }
          category {
            id
            name
            emoji
          }
          comments(first: 30) {
            totalCount
            nodes {
              id
              body
              createdAt
              upvoteCount
              isAnswer
              author {
                login
              }
            }
          }
        }
      }
    }
  `

  const data = await client.graphql(query, {
    owner,
    repo,
    number: Number(number),
  })

  const d = data?.repository?.discussion
  if (!d) throw new Error(`Discussion #${number} not found in ${owner}/${repo}`)

  const commentNodes = Array.isArray(d.comments?.nodes) ? d.comments.nodes : []

  return {
    id: d.id,
    number: d.number,
    title: d.title,
    body: d.body || '',
    url: d.url,
    createdAt: d.createdAt,
    upvoteCount: d.upvoteCount || 0,
    author: d.author?.login || 'ghost',
    category: d.category ? { id: d.category.id, name: d.category.name, emoji: d.category.emoji } : null,
    commentsCount: d.comments?.totalCount || commentNodes.length,
    comments: commentNodes.map((c) => ({
      id: c.id,
      body: c.body || '',
      createdAt: c.createdAt,
      upvoteCount: c.upvoteCount || 0,
      isAnswer: Boolean(c.isAnswer),
      author: c.author?.login || 'ghost',
    })),
  }
}

/** Create a new discussion (requires confirm: true). */
export async function createDiscussion(client, {
  owner, repo, title, body, categoryId, confirm = false,
} = {}) {
  ensureRepo({ owner, repo })
  if (!title) throw new Error('title is required')
  if (!body) throw new Error('body is required')

  if (confirm !== true) {
    return {
      dryRun: true,
      refused: 'confirm: true is required to publish a new discussion',
      target: `${owner}/${repo}`,
      title,
      bodyPreview: body.slice(0, 200),
      categoryId: categoryId || 'first_available',
    }
  }

  let repoId = ''
  let targetCatId = categoryId || ''

  const repoQuery = `
    query ResolveRepo($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
        discussionCategories(first: 10) {
          nodes {
            id
            name
          }
        }
      }
    }
  `
  const repoData = await client.graphql(repoQuery, { owner, repo })
  repoId = repoData?.repository?.id
  if (!repoId) throw new Error(`Cannot resolve repository ID for ${owner}/${repo}`)

  if (!targetCatId) {
    const cats = repoData?.repository?.discussionCategories?.nodes || []
    if (cats.length === 0) throw new Error(`Repository ${owner}/${repo} has no discussion categories enabled`)
    targetCatId = cats[0].id
  }

  const mutation = `
    mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
      createDiscussion(input: {repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body}) {
        discussion {
          id
          number
          title
          url
          createdAt
        }
      }
    }
  `

  const result = await client.graphql(mutation, {
    repositoryId: repoId,
    categoryId: targetCatId,
    title,
    body,
  })

  const disc = result?.createDiscussion?.discussion
  return {
    success: true,
    id: disc?.id,
    number: disc?.number,
    title: disc?.title,
    url: disc?.url,
    createdAt: disc?.createdAt,
  }
}

/** Comment on a discussion (requires confirm: true). */
export async function commentDiscussion(client, {
  owner, repo, discussionId, number, body, confirm = false,
} = {}) {
  ensureRepo({ owner, repo })
  if (!body) throw new Error('body is required')

  let targetId = discussionId
  if (!targetId && number) {
    const d = await getDiscussion(client, { owner, repo, number })
    targetId = d.id
  }
  if (!targetId) throw new Error('discussionId or discussion number is required')

  if (confirm !== true) {
    return {
      dryRun: true,
      refused: 'confirm: true is required to post a discussion comment',
      discussionId: targetId,
      bodyPreview: body.slice(0, 200),
    }
  }

  const mutation = `
    mutation AddComment($discussionId: ID!, $body: String!) {
      addDiscussionComment(input: {discussionId: $discussionId, body: $body}) {
        comment {
          id
          body
          url
          createdAt
          author {
            login
          }
        }
      }
    }
  `

  const result = await client.graphql(mutation, {
    discussionId: targetId,
    body,
  })

  const c = result?.addDiscussionComment?.comment
  return {
    success: true,
    id: c?.id,
    body: c?.body,
    url: c?.url,
    createdAt: c?.createdAt,
    author: c?.author?.login || 'unknown',
  }
}
