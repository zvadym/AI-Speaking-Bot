#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/ai-speaking-bot}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
REPO_URL="${REPO_URL:-}"

# Upload ignored config files from local repo -> server (won't overwrite by default).
UPLOAD_CONFIG="${UPLOAD_CONFIG:-true}"
FORCE_UPLOAD="${FORCE_UPLOAD:-false}"

log() { echo "==> $1"; }

usage() {
  cat <<'EOF'
Bootstrap a brand-new server so ./scripts/deploy-remote.sh works.

Usage:
  DEPLOY_HOST=mynewserver ./scripts/bootstrap-remote-server.sh

Common overrides:
  DEPLOY_DIR=/opt/ai-speaking-bot
  DEPLOY_BRANCH=main
  REPO_URL=git@github.com:you/AI-Speaking-Bot.git
  UPLOAD_CONFIG=true|false
  FORCE_UPLOAD=true|false   (overwrite existing remote config files)

What it does:
  - Installs git, python3, curl, rsync and Docker (+ compose plugin) on the server (Debian/Ubuntu)
  - Creates DEPLOY_DIR and clones the repo there (or reuses existing clone)
  - Uploads git-ignored env files from local repo to the server:
      deploy/.env.api
      deploy/.env.miniapp
      deploy/.env.prod

Notes:
  - It does NOT run docker compose or deploy anything. Run ./scripts/deploy-remote.sh after.
  - deploy/.env is tracked in git and is NOT uploaded by this script (to keep server git state clean).
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${DEPLOY_HOST}" ]]; then
  echo "DEPLOY_HOST is required."
  echo
  usage
  exit 1
fi

if [[ -z "${REPO_URL}" ]]; then
  if command -v git >/dev/null 2>&1; then
    REPO_URL="$(git -C "${ROOT_DIR}" remote get-url origin 2>/dev/null || true)"
  fi
fi

if [[ -z "${REPO_URL}" ]]; then
  echo "REPO_URL is required (or run inside a git repo with 'origin' remote set)."
  exit 1
fi

if [[ "${REPO_URL}" == *"'"* ]]; then
  echo "REPO_URL contains a single quote (') which this script can't safely pass over SSH."
  echo "Please pass a REPO_URL without single quotes."
  exit 1
fi

ssh_ok() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "${DEPLOY_HOST}" "echo 'SSH OK'" >/dev/null
}

remote_file_exists() {
  local rel="$1"
  ssh "${DEPLOY_HOST}" "test -f '${DEPLOY_DIR}/${rel}'"
}

upload_ignored_file() {
  local rel="$1"
  local local_path="${ROOT_DIR}/${rel}"
  local remote_path="${DEPLOY_DIR}/${rel}"

  if [[ ! -f "${local_path}" ]]; then
    echo "⚠️  Missing local file (skipping): ${local_path}" >&2
    return 0
  fi

  if remote_file_exists "${rel}"; then
    if [[ "${FORCE_UPLOAD}" != "true" ]]; then
      echo "⏭️  Remote file exists (skipping): ${remote_path}" >&2
      return 0
    fi
  fi

  ssh "${DEPLOY_HOST}" "mkdir -p \"$(dirname "${remote_path}")\""
  scp -p "${local_path}" "${DEPLOY_HOST}:${remote_path}"

  # Restrict env file permissions on the server (safe: docker compose reads them host-side).
  ssh "${DEPLOY_HOST}" "chmod 600 '${remote_path}'"
  echo "✅ Uploaded: ${rel}"
}

log "🔌 Step 1/4: Check SSH connectivity to ${DEPLOY_HOST}"
if ! ssh_ok; then
  echo "SSH failed. Make sure you can run: ssh ${DEPLOY_HOST}" >&2
  exit 1
fi

log "🧱 Step 2/4: Install prerequisites + Docker on remote (Debian/Ubuntu)"
ssh -tt "${DEPLOY_HOST}" \
  "DEPLOY_DIR='${DEPLOY_DIR}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' REPO_URL='${REPO_URL}' bash -se" <<'REMOTE'
set -euo pipefail

step() { echo "==> $1"; }

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required on the server." >&2
  exit 1
fi

step "2.1/6: Sudo auth"
sudo -v

step "2.2/6: Detect OS"
if [[ ! -r /etc/os-release ]]; then
  echo "Missing /etc/os-release; can't detect distro." >&2
  exit 1
fi
. /etc/os-release
os_id="${ID:-}"
codename="${VERSION_CODENAME:-}"
if [[ -z "${codename}" && -n "${UBUNTU_CODENAME:-}" ]]; then
  codename="${UBUNTU_CODENAME}"
fi
case "${os_id}" in
  ubuntu|debian) ;;
  *)
    echo "Unsupported distro: ${os_id}. This script supports Debian/Ubuntu." >&2
    exit 1
    ;;
esac
if [[ -z "${codename}" ]]; then
  echo "Could not determine distro codename (VERSION_CODENAME)." >&2
  exit 1
fi

step "2.3/6: Install base packages"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release git python3 rsync

step "2.4/6: Install Docker + compose plugin (if missing)"
need_docker="false"
if ! command -v docker >/dev/null 2>&1; then
  need_docker="true"
elif ! docker compose version >/dev/null 2>&1; then
  need_docker="true"
fi

if [[ "${need_docker}" == "true" ]]; then
  sudo install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL "https://download.docker.com/linux/${os_id}/gpg" | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${os_id} ${codename} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
fi

step "2.5/6: Ensure current user can run docker (docker group)"
if ! id -nG "${USER}" | tr ' ' '\n' | grep -qx docker; then
  sudo usermod -aG docker "${USER}"
  echo "Added ${USER} to docker group. New SSH sessions will pick this up."
fi

step "2.6/6: Create deploy dir + clone repo (or reuse existing clone)"
sudo mkdir -p "${DEPLOY_DIR}"
sudo chown -R "${USER}:${USER}" "${DEPLOY_DIR}"

cd "${DEPLOY_DIR}"
if [[ -d .git ]]; then
  echo "Repo already present at ${DEPLOY_DIR}."
else
  if [[ -n "$(ls -A 2>/dev/null)" ]]; then
    echo "${DEPLOY_DIR} is not empty and not a git repo; refusing to clone into it." >&2
    exit 1
  fi
  git clone "${REPO_URL}" .
fi

git fetch origin >/dev/null 2>&1 || true
if git show-ref --verify --quiet "refs/remotes/origin/${DEPLOY_BRANCH}"; then
  git checkout -B "${DEPLOY_BRANCH}" "origin/${DEPLOY_BRANCH}"
fi

echo "Remote setup OK."
python3 --version || true
docker --version || true
docker compose version || true
REMOTE

if [[ "${UPLOAD_CONFIG}" == "true" ]]; then
  log "📤 Step 3/4: Upload git-ignored env files to remote (won't overwrite by default)"
  upload_ignored_file "deploy/.env.api"
  upload_ignored_file "deploy/.env.miniapp"
  upload_ignored_file "deploy/.env.prod"
else
  log "⏭️  Step 3/4: Skipping config upload (UPLOAD_CONFIG=false)"
fi

log "🔎 Step 4/4: Verify required files exist (names only)"
ssh "${DEPLOY_HOST}" \
  "cd '${DEPLOY_DIR}' && for f in deploy/.env deploy/.env.api deploy/.env.miniapp deploy/.env.prod; do test -f \"\$f\" && echo \"✅ \$f\" || (echo \"❌ Missing \$f\" >&2; exit 1); done"

log "✅ Bootstrap complete. Next:"
echo "DEPLOY_HOST='${DEPLOY_HOST}' DEPLOY_DIR='${DEPLOY_DIR}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' ./scripts/deploy-remote.sh"
