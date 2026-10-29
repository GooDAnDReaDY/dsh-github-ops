import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {
  normalizeAxes,
  isCuratedList,
  findRepos,
  calculateRepoScore,
  exploreTopic,
  searchIssuesAdvanced,
} from '../lib/tools/explore.js'
import { trendingRepos } from '../lib/tools/insights.js'

test('normalizeAxes parses array of strings, objects, and key-value maps', () => {
  // String format "name|query"
  const fromStrings = normalizeAxes(['frameworks|multi-agent frameworks', 'protocols|a2a protocol'])
  assert.deepEqual(fromStrings, [
    { name: 'frameworks', query: 'multi-agent frameworks' },
    { name: 'protocols', query: 'a2a protocol' },
  ])

  // Object format
  const fromObjs = normalizeAxes([
    { name: 'runtimes', query: 'wasm sandbox' },
    { axis: 'models', q: 'local llm' },
  ])
  assert.deepEqual(fromObjs, [
    { name: 'runtimes', query: 'wasm sandbox' },
    { name: 'models', query: 'local llm' },
  ])

  // Dictionary map format
  const fromDict = normalizeAxes({
    tools: 'mcp servers',
    evaluation: 'agent benchmark',
  })
  assert.deepEqual(fromDict, [
    { name: 'tools', query: 'mcp servers' },
    { name: 'evaluation', query: 'agent benchmark' },
  ])

  // Empty / invalid cases
  assert.deepEqual(normalizeAxes(null), [])
  assert.deepEqual(normalizeAxes([]), [])
  assert.deepEqual(normalizeAxes(['', 'invalid-only']), [{ name: 'invalid-only', query: 'invalid-only' }])
})

test('isCuratedList detects awesome-lists and curated collections', () => {
  assert.equal(isCuratedList({ fullName: 'sindresorhus/awesome-nodejs' }), true)
  assert.equal(isCuratedList({ fullName: 'user/awesome' }), true)
  assert.equal(isCuratedList({ fullName: 'org/agent-awesome' }), true)
  assert.equal(isCuratedList({ fullName: 'foo/bar', topics: ['awesome', 'agent'] }), true)
  assert.equal(isCuratedList({ fullName: 'foo/bar', description: 'A curated list of awesome agent tools' }), true)

  // Normal project
  assert.equal(isCuratedList({ fullName: 'crewAIInc/crewAI', description: 'Framework for orchestrating agents', topics: ['agent'] }), false)
  assert.equal(isCuratedList({ fullName: 'modelcontextprotocol/servers', description: 'Model Context Protocol servers' }), false)
})

test('findRepos excludes forks and archived repos by default and applies minStars', async () => {
  const calledQueries = []
  const fakeClient = {
    get: async (url, opts) => {
      calledQueries.push(opts.query)
      return {
        data: {
          total_count: 2,
          items: [
            {
              full_name: 'test/repo-1',
              description: 'First repo',
              stargazers_count: 150,
              forks_count: 20,
              pushed_at: new Date().toISOString(),
            },
            {
              full_name: 'test/repo-1', // duplicate to test deduplication
              stargazers_count: 150,
            },
            {
              full_name: 'test/repo-2',
              description: 'Second repo',
              stargazers_count: 80,
            },
          ],
        },
      }
    },
  }

  const res = await findRepos(fakeClient, {
    query: 'multi-agent',
    language: 'python',
    minStars: 20,
  })

  assert.equal(calledQueries.length, 1)
  assert.match(calledQueries[0].q, /multi-agent/)
  assert.match(calledQueries[0].q, /fork:false/)
  assert.match(calledQueries[0].q, /archived:false/)
  assert.match(calledQueries[0].q, /stars:>=20/)
  assert.match(calledQueries[0].q, /language:python/)
  assert.equal(res.count, 2, 'deduplication should drop the repeated test/repo-1')
  assert.equal(res.repos[0].fullName, 'test/repo-1')
})

test('calculateRepoScore ranks cross-axis hits higher and penalizes awesome-lists', () => {
  const repoA = { fullName: 'org/cross-tool', stars: 2000, forks: 200, pushedAt: new Date().toISOString() }
  const repoB = { fullName: 'org/single-high', stars: 80000, forks: 5000, pushedAt: new Date().toISOString() }
  const repoAwesome = { fullName: 'org/awesome-agents', stars: 50000, forks: 4000, pushedAt: new Date().toISOString() }

  // 1 axis hit for high-star repo
  const scoreB = calculateRepoScore(repoB, 1, 3).score
  // 3 axes hit for lower-star repo
  const scoreA = calculateRepoScore(repoA, 3, 3).score

  // Cross-axis hit should outrank a single-axis hit
  assert.ok(scoreA > scoreB, `cross-axis score (${scoreA}) must exceed single-axis score (${scoreB})`)

  // Awesome list penalty check
  const awesomeRes = calculateRepoScore(repoAwesome, 2, 3)
  assert.equal(awesomeRes.isCuratedList, true)
  assert.ok(awesomeRes.score < scoreA, 'awesome-list must be penalized below actual tool')
})

test('exploreTopic runs multi-axis search, writes full report, and returns compact summary <= 3 KB', async () => {
  const fakeReposAxis1 = [
    { full_name: 'shared/hybrid-agent', stargazers_count: 3500, forks_count: 300, description: 'Hybrid agent framework' },
    { full_name: 'lib/framework-alpha', stargazers_count: 12000, forks_count: 800, description: 'Agent framework' },
    { full_name: 'curated/awesome-agents', stargazers_count: 25000, forks_count: 2000, description: 'Awesome list' },
  ]
  const fakeReposAxis2 = [
    { full_name: 'shared/hybrid-agent', stargazers_count: 3500, forks_count: 300, description: 'Hybrid agent framework' },
    { full_name: 'proto/agent-wire', stargazers_count: 1500, forks_count: 100, description: 'Wire protocol' },
  ]

  const fakeClient = {
    get: async (_url, opts) => {
      if (opts.query.q.includes('frameworks')) return { data: { items: fakeReposAxis1 } }
      if (opts.query.q.includes('protocols')) return { data: { items: fakeReposAxis2 } }
      return { data: { items: [] } }
    },
  }

  const result = await exploreTopic(fakeClient, {
    axes: [
      'frameworks|agent frameworks',
      'protocols|agent communication protocols',
    ],
    minStars: 10,
    writeReport: true,
  })

  // 1. Cross-axis leaders
  assert.equal(result.axes.length, 2)
  assert.ok(result.crossAxisLeaders.length > 0)
  assert.equal(result.crossAxisLeaders[0].fullName, 'shared/hybrid-agent')
  assert.deepEqual(result.crossAxisLeaders[0].matchedAxes.sort(), ['frameworks', 'protocols'])

  // 2. Awesome list demotion
  assert.ok(result.awesomeLists.some((a) => a.fullName === 'curated/awesome-agents'))
  assert.ok(!result.crossAxisLeaders.some((c) => c.fullName.includes('awesome')))

  // 3. Full report written to disk
  assert.ok(result.fullReportPath, 'report file path must be present')
  const diskData = await fs.readFile(result.fullReportPath, 'utf8')
  const parsed = JSON.parse(diskData)
  assert.equal(parsed.axes.length, 2)
  assert.ok(parsed.allRepositories.length >= 3)
  await fs.unlink(result.fullReportPath)

  // 4. Context economy: summary <= 3 KB
  const jsonSize = Buffer.byteLength(JSON.stringify(result), 'utf8')
  assert.ok(jsonSize <= 3072, `compact summary must be <= 3 KB, was ${jsonSize} bytes`)
})

test('searchIssuesAdvanced constructs GitHub search syntax query with filters', async () => {
  let executedQuery = null
  const fakeClient = {
    get: async (_url, opts) => {
      executedQuery = opts.query
      return {
        data: {
          total_count: 1,
          items: [
            {
              number: 42,
              title: 'Memory leak in worker pool',
              state: 'open',
              repository_url: 'https://api.github.com/repos/org/repo',
              user: { login: 'octocat' },
            },
          ],
        },
      }
    },
  }

  const res = await searchIssuesAdvanced(fakeClient, {
    query: 'memory leak',
    repo: 'org/repo',
    state: 'open',
    type: 'issue',
    author: 'octocat',
    labels: ['bug', 'performance'],
  })

  assert.match(executedQuery.q, /memory leak/)
  assert.match(executedQuery.q, /repo:org\/repo/)
  assert.match(executedQuery.q, /is:open/)
  assert.match(executedQuery.q, /is:issue/)
  assert.match(executedQuery.q, /author:octocat/)
  assert.match(executedQuery.q, /label:bug/)
  assert.match(executedQuery.q, /label:performance/)
  assert.equal(res.count, 1)
  assert.equal(res.issues[0].repository, 'org/repo')
})

test('trendingRepos supports window daily, weekly, monthly and topic filter', async () => {
  let executedQuery = null
  const fakeClient = {
    get: async (_url, opts) => {
      executedQuery = opts.query
      return { data: { items: [] } }
    },
  }

  const res = await trendingRepos(fakeClient, {
    window: 'weekly',
    topic: 'ai-agents',
    language: 'rust',
    minStars: 100,
  })

  assert.equal(res.window, 'weekly')
  assert.match(executedQuery.q, /created:>\d{4}-\d{2}-\d{2}/)
  assert.match(executedQuery.q, /stars:>=100/)
  assert.match(executedQuery.q, /language:rust/)
  assert.match(executedQuery.q, /topic:ai-agents/)
})
