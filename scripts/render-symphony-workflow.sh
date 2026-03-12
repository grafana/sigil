#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template_path="${repo_root}/WORKFLOW.md"
output_path="${repo_root}/WORKFLOW.local.md"
placeholder="__SYMPHONY_LINEAR_PROJECT_SLUG__"
project_slug="${1:-${SYMPHONY_LINEAR_PROJECT_SLUG:-}}"

if [[ -z "${project_slug}" ]]; then
  cat <<'EOF' >&2
Missing Symphony Linear project slug.

Usage:
  ./scripts/render-symphony-workflow.sh <project-slug>

or:
  SYMPHONY_LINEAR_PROJECT_SLUG=<project-slug> ./scripts/render-symphony-workflow.sh
EOF
  exit 1
fi

if ! grep -q "${placeholder}" "${template_path}"; then
  echo "Template placeholder ${placeholder} not found in ${template_path}" >&2
  exit 1
fi

export TEMPLATE_PATH="${template_path}"
export OUTPUT_PATH="${output_path}"
export PROJECT_SLUG="${project_slug}"
export PLACEHOLDER="${placeholder}"

node <<'EOF'
const fs = require('node:fs');

const templatePath = process.env.TEMPLATE_PATH;
const outputPath = process.env.OUTPUT_PATH;
const projectSlug = process.env.PROJECT_SLUG;
const placeholder = process.env.PLACEHOLDER;

const template = fs.readFileSync(templatePath, 'utf8');
const rendered = template.replaceAll(placeholder, projectSlug);

fs.writeFileSync(outputPath, rendered);
console.log(outputPath);
EOF
