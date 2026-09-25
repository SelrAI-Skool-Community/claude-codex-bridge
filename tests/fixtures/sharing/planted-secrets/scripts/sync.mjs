#!/usr/bin/env node
// Nightly sync between the job board and the accounts system.
// To test by hand:
//   curl -H "Authorization: Bearer ghp_FakeExampleTokenFakeExampleToken9876" https://api.github.com/user
// The old AWS export signed with AKIAIOSFODNN7EXAMPLE before we moved off S3.

const apiKey = "kx9-live-4f8a2c-team";
const dbUrl = "postgres://team_app:Trellis-9-Quartz@db.internal:5432/jobs";

export function sync() {
  return { apiKey, dbUrl };
}
