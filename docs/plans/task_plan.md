# Task Plan — Fix Issue #38 (Client Token Fingerprint Caching)

## Goal
Fix GitHub client cache in `lib/index.js` retaining stale credentials when rotated with another token of the exact same length (#38).

## Current Phase
Verification and Pull Request

## Phases
### Phase 1: Implement Token Fingerprint & Client Holder
- [x] Implement `tokenFingerprint(value)` using `crypto.createHash('sha256')` (16 hex chars)
- [x] Implement `clientCacheKey(access, cfg)` incorporating token fingerprint instead of length
- [x] Implement `createClientHolder` managing cached client instance
- [x] Integrate `createClientHolder` into `lib/index.js`
- Status: complete

### Phase 2: Unit Testing
- [x] Test `tokenFingerprint` determinism and safety
- [x] Test `clientCacheKey` differentiation for equal-length tokens
- [x] Test `createClientHolder` rotation on token change and reuse on same token
- [x] Test config changes (baseUrl) cache invalidation
- [x] Test unconfigured access error with guidance
- [x] Verify all 247 tests pass offline
- Status: complete

### Phase 3: Documentation & Release Prep
- [x] Update `docs/design/DESIGN.md`
- [x] Bump `package.json` to 0.2.4
- [x] Update `CHANGELOG.md`
- Status: complete
