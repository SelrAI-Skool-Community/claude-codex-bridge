#!/usr/bin/env node
// Draft release notes. All credentials come from the environment.

const token = process.env.GITHUB_TOKEN;
const apiKey = process.env.RELEASE_API_KEY || "";
const example = { password: "changeme-example", apiKey: "<YOUR_API_KEY>" };

export function draft(changelog) {
  return { token: Boolean(token), apiKey: Boolean(apiKey), example, changelog };
}
