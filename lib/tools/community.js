// Community health files scaffolding tools.
// Standardized templates for GoodAndReady open source plugins and repositories.

import { pushFiles } from './write-files.js'

export const TEMPLATE_KEYS = [
  'bug_report',
  'feature_request',
  'security_advisory',
  'pull_request',
  'security',
  'contributing',
  'code_of_conduct',
]

/** Generate file mapping for requested community templates. */
export function getCommunityTemplates({
  projectName = 'Project',
  contactEmail = 'security@goodandready.app',
  defaultBranch = 'main',
  supportVersion = '>= 0.6.0',
} = {}) {
  const templates = {}

  templates['.github/ISSUE_TEMPLATE/bug_report.md'] = `---
name: Bug Report
about: Create a report to help us improve
title: 'fix: '
labels: ['bug']
assignees: ''
---

### 1. Context & Description
<!-- A clear and concise description of what the bug is. -->

### 2. Steps to Reproduce
1. Go to '...'
2. Click on '....'
3. See error

### 3. Expected Behavior
<!-- What you expected to happen. -->

### 4. Actual Behavior / Logs
<!-- Screenshots or error logs if applicable. -->

### 5. Environment
- OS: [e.g. Linux / Windows]
- Node version: [e.g. 22.x]
- Plugin version: [e.g. ${supportVersion}]
`

  templates['.github/ISSUE_TEMPLATE/feature_request.md'] = `---
name: Feature Request
about: Suggest an idea or enhancement
title: 'feat: '
labels: ['enhancement']
assignees: ''
---

### 1. Problem Statement
<!-- Is your feature request related to a problem? Please describe. -->

### 2. Proposed Solution
<!-- Describe the solution you'd like. -->

### 3. Acceptance Criteria
- [ ] Functional requirements met
- [ ] Automated tests added
- [ ] Documentation updated

### 4. Alternatives Considered
<!-- Any alternatives or workaround you have considered. -->
`

  templates['.github/ISSUE_TEMPLATE/security_advisory.md'] = `---
name: Security Vulnerability
about: Privately report a security issue
title: 'sec: '
labels: ['security']
assignees: ''
---

> [!IMPORTANT]
> If this is a critical zero-day security vulnerability, please contact ${contactEmail} directly instead of opening a public issue.

### 1. Summary
### 2. Severity & Impact
### 3. Steps / Proof of Concept
### 4. Remediation / Suggested Patch
`

  templates['.github/PULL_REQUEST_TEMPLATE.md'] = `## 1. Context & Problem
<!-- Reference issue or explain the problem solved. -->

## 2. Proposed Changes
<!-- Detailed explanation of architectural and code modifications. -->

## 3. Verification & Testing
- [ ] Unit tests added / updated
- [ ] All tests passing (\`npm test\`)
- [ ] No regression on existing invariants

## 4. Documentation & Contracts
- [ ] Documentation updated (README / API docs)
- [ ] Conventional Commits used for automated release notes

## 5. Review Checklist
- [ ] Code style and lint verified
- [ ] Zero hardcoded secrets or credentials
`

  templates['SECURITY.md'] = `# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| ${supportVersion} | :white_check_mark: |
| < 0.6.0 | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities directly to \`${contactEmail}\`.
All reports will be acknowledged within 48 hours, and an advisory/patch roadmap provided within 7 days.
`

  templates['CONTRIBUTING.md'] = `# Contributing to ${projectName}

Thank you for your interest in contributing!

## Development Workflow
1. Fork or branch from \`${defaultBranch}\`.
2. Install dependencies: \`pnpm install\` or \`npm install\`.
3. Run tests: \`npm test\`.

## Conventional Commits
We follow the Conventional Commits specification:
- \`feat:\` new feature (triggers minor version bump)
- \`fix:\` bug fix (triggers patch bump)
- \`perf:\` performance improvement
- \`refactor:\` code refactoring
- \`docs:\` documentation updates
- \`chore:\` maintenance and tooling
- \`BREAKING CHANGE:\` incompatible API change (triggers major bump)

## Pull Request Process
- Fill out the 5-section PR template.
- Ensure all automated checks pass.
`

  templates['CODE_OF_CONDUCT.md'] = `# Contributor Covenant Code of Conduct

## Our Pledge
We as members, contributors, and leaders pledge to make participation in our
community a harassment-free experience for everyone, regardless of age, body
size, visible or invisible disability, ethnicity, sex characteristics, gender
identity and expression, level of experience, education, socio-economic status,
nationality, personal appearance, race, caste, color, religion, or sexual
identity and orientation.

## Enforcement & Contact
Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported to the community leadership at \`${contactEmail}\`.
`

  return templates
}

/** Map friendly template keys to path patterns */
const KEY_TO_PATH_PATTERN = {
  bug_report: '.github/ISSUE_TEMPLATE/bug_report.md',
  feature_request: '.github/ISSUE_TEMPLATE/feature_request.md',
  security_advisory: '.github/ISSUE_TEMPLATE/security_advisory.md',
  issue_templates: '.github/ISSUE_TEMPLATE/',
  pull_request: '.github/PULL_REQUEST_TEMPLATE.md',
  pr_template: '.github/PULL_REQUEST_TEMPLATE.md',
  security: 'SECURITY.md',
  contributing: 'CONTRIBUTING.md',
  code_of_conduct: 'CODE_OF_CONDUCT.md',
}

/** Scaffold community files into a repo branch or preview via dryRun. */
export async function scaffoldCommunityFiles(client, {
  owner, repo, branch, templates = 'all', options = {}, dryRun = false, message,
} = {}) {
  const allTemplates = getCommunityTemplates({
    projectName: options.projectName || repo || 'Project',
    contactEmail: options.contactEmail || 'security@goodandready.app',
    defaultBranch: branch || 'main',
    supportVersion: options.supportVersion || '>= 0.6.0',
  })

  let selectedPaths = Object.keys(allTemplates)
  if (Array.isArray(templates) && !templates.includes('all')) {
    const desiredPatterns = templates.map((t) => KEY_TO_PATH_PATTERN[t] || t)
    selectedPaths = selectedPaths.filter((filePath) =>
      desiredPatterns.some((pattern) => filePath === pattern || filePath.startsWith(pattern))
    )
  }

  const files = selectedPaths.map((filePath) => ({
    path: filePath,
    content: allTemplates[filePath],
  }))

  if (dryRun) {
    return {
      dryRun: true,
      repository: `${owner}/${repo}`,
      branch: branch || 'main',
      count: files.length,
      files,
    }
  }

  if (!client || !owner || !repo) {
    throw new Error('client, owner and repo are required to commit files')
  }

  const commitMessage = message || 'chore: scaffold GoodAndReady community health files'
  const pushed = await pushFiles(client, {
    owner,
    repo,
    branch: branch || 'main',
    message: commitMessage,
    files,
  })

  return {
    success: true,
    repository: `${owner}/${repo}`,
    branch: pushed.branch,
    commit: pushed.commit,
    count: files.length,
    files: files.map((f) => f.path),
  }
}
