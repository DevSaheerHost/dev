#!/usr/bin/env bash
#
# Deploys the Firestore security rules and composite indexes for My Work Ledger.
#
# Run this from `my-work-ledger/`. It needs the Firebase CLI and an account with
# access to the project named in `.firebaserc`.
#
#   npm install -g firebase-tools
#   firebase login
#   ./deploy.sh
#
# This deploys rules and indexes ONLY. It never touches data, and it never
# touches Authentication settings — enabling Email/Password sign-in and then
# disabling self-signup are console actions, described in README.md.
#
# The rules file is the complete ruleset for this project. That is safe because
# `my-web-b35e3` is dedicated to this app; if you ever add another app to the
# same project, merge its rules into `firebase/firestore.rules` rather than
# deploying them separately, because each deploy replaces the whole ruleset.

set -euo pipefail

cd "$(dirname "$0")"

if ! command -v firebase >/dev/null 2>&1; then
  echo "The Firebase CLI is not installed. Run: npm install -g firebase-tools" >&2
  exit 1
fi

project="$(python3 -c 'import json;print(json.load(open(".firebaserc"))["projects"]["default"])')"
echo "Deploying Firestore rules and indexes to project: ${project}"
echo

firebase deploy --only firestore:rules,firestore:indexes --project "${project}"

echo
echo "Done. Indexes can take a few minutes to finish building."
echo "Remaining console steps are listed in README.md."
