import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listDiscussions,
  getDiscussion,
  createDiscussion,
  commentDiscussion,
} from '../lib/tools/discussions.js'

test('listDiscussions executes GraphQL query and returns mapped discussions', async () => {
  let capturedQuery = null
  let capturedVars = null

  const client = {
    graphql: async (query, vars) => {
      capturedQuery = query
      capturedVars = vars
      return {
        repository: {
          discussions: {
            totalCount: 1,
            nodes: [
              {
                id: 'D_123',
                number: 10,
                title: 'Welcome to Discussions',
                url: 'https://github.com/o/r/discussions/10',
                createdAt: '2026-01-01T00:00:00Z',
                upvoteCount: 5,
                author: { login: 'vadim' },
                category: { id: 'CAT_1', name: 'General', emoji: '💬' },
                comments: { totalCount: 3 },
              },
            ],
          },
        },
      }
    },
  }

  const res = await listDiscussions(client, { owner: 'o', repo: 'r', limit: 10 })
  assert.equal(res.totalCount, 1)
  assert.equal(res.discussions[0].number, 10)
  assert.equal(res.discussions[0].author, 'vadim')
  assert.equal(res.discussions[0].category.name, 'General')
  assert.equal(capturedVars.first, 10)
})

test('getDiscussion views discussion details and comments', async () => {
  const client = {
    graphql: async (query, vars) => {
      return {
        repository: {
          discussion: {
            id: 'D_123',
            number: vars.number,
            title: 'Q&A on setup',
            body: 'How do I install?',
            url: 'https://github.com/o/r/discussions/10',
            createdAt: '2026-01-01T00:00:00Z',
            upvoteCount: 2,
            author: { login: 'alice' },
            category: { id: 'CAT_1', name: 'Q&A' },
            comments: {
              totalCount: 1,
              nodes: [
                {
                  id: 'DC_1',
                  body: 'Run pnpm install',
                  createdAt: '2026-01-01T01:00:00Z',
                  upvoteCount: 1,
                  isAnswer: true,
                  author: { login: 'bob' },
                },
              ],
            },
          },
        },
      }
    },
  }

  const res = await getDiscussion(client, { owner: 'o', repo: 'r', number: 10 })
  assert.equal(res.id, 'D_123')
  assert.equal(res.author, 'alice')
  assert.equal(res.comments.length, 1)
  assert.equal(res.comments[0].isAnswer, true)
  assert.equal(res.comments[0].author, 'bob')
})

test('createDiscussion requires confirm: true and posts mutation', async () => {
  // 1. Dry run
  const dry = await createDiscussion({}, {
    owner: 'o',
    repo: 'r',
    title: 'New proposal',
    body: 'Details here',
    confirm: false,
  })
  assert.equal(dry.dryRun, true)
  assert.ok(dry.refused.includes('confirm: true is required'))

  // 2. Confirmed creation
  let mutationVars = null
  const client = {
    graphql: async (query, vars) => {
      if (query.includes('ResolveRepo')) {
        return {
          repository: {
            id: 'REPO_1',
            discussionCategories: {
              nodes: [{ id: 'CAT_DEFAULT', name: 'General' }],
            },
          },
        }
      }
      mutationVars = vars
      return {
        createDiscussion: {
          discussion: {
            id: 'D_NEW',
            number: 42,
            title: vars.title,
            url: 'https://github.com/o/r/discussions/42',
            createdAt: '2026-01-01T00:00:00Z',
          },
        },
      }
    },
  }

  const res = await createDiscussion(client, {
    owner: 'o',
    repo: 'r',
    title: 'New proposal',
    body: 'Details here',
    confirm: true,
  })

  assert.equal(res.success, true)
  assert.equal(res.id, 'D_NEW')
  assert.equal(res.number, 42)
  assert.equal(mutationVars.repositoryId, 'REPO_1')
  assert.equal(mutationVars.categoryId, 'CAT_DEFAULT')
})

test('commentDiscussion requires confirm: true and posts reply', async () => {
  const dry = await commentDiscussion({}, {
    owner: 'o',
    repo: 'r',
    discussionId: 'D_123',
    body: 'Great answer!',
    confirm: false,
  })
  assert.equal(dry.dryRun, true)
  assert.ok(dry.refused.includes('confirm: true is required'))

  const client = {
    graphql: async (query, vars) => ({
      addDiscussionComment: {
        comment: {
          id: 'DC_99',
          body: vars.body,
          url: 'https://github.com/o/r/discussions/10#comment-99',
          createdAt: '2026-01-01T00:00:00Z',
          author: { login: 'vadim' },
        },
      },
    }),
  }

  const res = await commentDiscussion(client, {
    owner: 'o',
    repo: 'r',
    discussionId: 'D_123',
    body: 'Great answer!',
    confirm: true,
  })

  assert.equal(res.success, true)
  assert.equal(res.id, 'DC_99')
  assert.equal(res.body, 'Great answer!')
})
