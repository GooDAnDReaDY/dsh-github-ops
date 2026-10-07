import test from 'node:test'
import assert from 'node:assert/strict'
import { auditTokenScopes, CAPABILITY_REQUIREMENTS } from '../lib/token-audit.js'

test('auditTokenScopes handles empty or missing scopes as fine-grained token', () => {
  const result1 = auditTokenScopes('')
  assert.equal(result1.isFineGrained, true)
  assert.equal(result1.scopes.length, 0)
  assert.ok(result1.warnings.some((w) => w.includes('fine-grained')))

  const result2 = auditTokenScopes(null)
  assert.equal(result2.isFineGrained, true)
})

test('auditTokenScopes detects full repo and workflow access', () => {
  const result = auditTokenScopes('repo, workflow, write:packages, read:org')
  assert.equal(result.isFineGrained, false)
  assert.equal(result.hasFullRepoAccess, true)
  assert.equal(result.hasWorkflowAccess, true)
  assert.equal(result.missing.length, 0)
  assert.equal(result.warnings.length, 0)
  assert.ok(result.capabilities.every((c) => c.granted === true))
})

test('auditTokenScopes detects missing workflow and package scopes', () => {
  const result = auditTokenScopes('public_repo')
  assert.equal(result.isFineGrained, false)
  assert.equal(result.hasFullRepoAccess, false)
  assert.equal(result.hasWorkflowAccess, false)
  
  // Public repo capability should be granted
  const pub = result.capabilities.find((c) => c.capability.includes('Public'))
  assert.equal(pub.granted, true)

  // Private repo capability should be missing
  const priv = result.capabilities.find((c) => c.capability.includes('Private'))
  assert.equal(priv.granted, false)

  // Workflow capability should be missing
  const wf = result.capabilities.find((c) => c.capability.includes('Workflows'))
  assert.equal(wf.granted, false)

  assert.ok(result.warnings.some((w) => w.includes('workflow')))
})

test('auditTokenScopes normalizes spaces and uppercase scopes', () => {
  const result = auditTokenScopes('  REPO ,  WORKFLOW ')
  assert.deepEqual(result.scopes, ['repo', 'workflow'])
  assert.equal(result.hasFullRepoAccess, true)
  assert.equal(result.hasWorkflowAccess, true)
})
