#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/ai-speaking-bot}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_CONFIG_DIR="${DEPLOY_CONFIG_DIR:-/etc/ai-speaking-bot}"
source "$ROOT_DIR/scripts/private-env.sh"
REPO_URL="${REPO_URL:-}"

# How to handle sudo:
# - auto (default): require passwordless sudo (no prompt); fail with instructions if password is needed
# - prompt: allow sudo to prompt for password (requires a TTY)
SUDO_MODE="${SUDO_MODE:-auto}"

# SSH agent forwarding (useful for private GitHub repos with SSH clone URLs).
SSH_FORWARD_AGENT="${SSH_FORWARD_AGENT:-false}"

# Upload external private config files to the server (no overwrite by default).
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
  DEPLOY_CONFIG_DIR=/etc/ai-speaking-bot
  REPO_URL=git@github.com:YOUR_ORG/YOUR_REPO.git
  SUDO_MODE=auto|prompt
  SSH_FORWARD_AGENT=true
  UPLOAD_CONFIG=true|false
  FORCE_UPLOAD=true|false   (overwrite existing remote config files)

What it does:
  - Installs git, python3, curl, rsync and Docker (+ compose plugin) on the server (Debian/Ubuntu)
  - Creates DEPLOY_DIR and clones the repo there (or reuses existing clone)
  - Uploads API_ENV_FILE and MINIAPP_ENV_FILE from outside the checkout to
    DEPLOY_CONFIG_DIR/api.env and DEPLOY_CONFIG_DIR/miniapp.env (mode 0600)

Notes:
  - If your server requires a sudo password, re-run with: SUDO_MODE=prompt
  - If git clone fails on a private repo, prefer SSH + agent forwarding:
      REPO_URL=git@github.com:... SSH_FORWARD_AGENT=true DEPLOY_HOST=... ./scripts/bootstrap-remote-server.sh
  - It does NOT run docker compose or deploy anything. Run ./scripts/deploy-remote.sh after.
  - Bot credentials must already be present in the local private API_ENV_FILE.
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

if [[ "${SUDO_MODE}" != "auto" && "${SUDO_MODE}" != "prompt" ]]; then
  echo "Invalid SUDO_MODE=${SUDO_MODE} (expected: auto|prompt)" >&2
  exit 1
fi

if [[ "${SSH_FORWARD_AGENT}" != "true" && "${SSH_FORWARD_AGENT}" != "false" ]]; then
  echo "Invalid SSH_FORWARD_AGENT=${SSH_FORWARD_AGENT} (expected: true|false)" >&2
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

ssh_cmd() {
  if [[ "${SSH_FORWARD_AGENT}" == "true" ]]; then
    ssh -A "$@"
  else
    ssh "$@"
  fi
}

scp_cmd() {
  if [[ "${SSH_FORWARD_AGENT}" == "true" ]]; then
    scp -A "$@"
  else
    scp "$@"
  fi
}

run_remote_setup() {
  if [[ "${SUDO_MODE}" == "prompt" ]]; then
    ssh_cmd -tt "${DEPLOY_HOST}" \
      "DEPLOY_DIR='${DEPLOY_DIR}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' DEPLOY_CONFIG_DIR='${DEPLOY_CONFIG_DIR}' REPO_URL='${REPO_URL}' SUDO_MODE='${SUDO_MODE}' bash -se"
  else
    ssh_cmd "${DEPLOY_HOST}" \
      "DEPLOY_DIR='${DEPLOY_DIR}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' DEPLOY_CONFIG_DIR='${DEPLOY_CONFIG_DIR}' REPO_URL='${REPO_URL}' SUDO_MODE='${SUDO_MODE}' bash -se"
  fi
}

upload_private_file() {
  local local_path="$1"
  local name="$2"
  local remote_path="${DEPLOY_CONFIG_DIR}/${name}.env"
  python3 "$ROOT_DIR/scripts/private_env.py" check "$local_path"
  if ssh_cmd "$DEPLOY_HOST" "test -f '$remote_path'"; then
    if [[ "$FORCE_UPLOAD" != "true" ]]; then
      echo "Remote file exists (skipping): $remote_path" >&2
      return 0
    fi
  fi
  # mktemp prevents a partially transferred file from replacing working config.
  local temporary
  temporary="$(ssh_cmd "$DEPLOY_HOST" "umask 077; mktemp '${DEPLOY_CONFIG_DIR}/.upload-XXXXXXXX'")"
  scp_cmd "$local_path" "${DEPLOY_HOST}:${temporary}"
  ssh_cmd "$DEPLOY_HOST" "chmod 600 '$temporary' && mv '$temporary' '$remote_path'"
  echo "Uploaded private ${name}.env"
}

for value_name in DEPLOY_DIR DEPLOY_CONFIG_DIR DEPLOY_BRANCH REPO_URL; do
  value="${!value_name}"
  if [[ "$value" == *"'"* || "$value" == *$'\n'* ]]; then
    echo "Invalid character in $value_name" >&2
    exit 1
  fi
done
if [[ "$UPLOAD_CONFIG" == "true" ]]; then
  python3 "$ROOT_DIR/scripts/private_env.py" check "$API_ENV_FILE" "$MINIAPP_ENV_FILE" --bots-dir "$ROOT_DIR/deploy/bots" --deployment
fi

log "🔌 Step 1/4: Check SSH connectivity to ${DEPLOY_HOST}"
if ! ssh_ok; then
  echo "SSH failed. Make sure you can run: ssh ${DEPLOY_HOST}" >&2
  exit 1
fi

log "🧱 Step 2/4: Install prerequisites + Docker on remote (Debian/Ubuntu)"
run_remote_setup <<'REMOTE'
set -euo pipefail

step() { echo "==> $1"; }

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required on the server." >&2
  exit 1
fi

step "2.1/6: Sudo auth"
if [[ "${SUDO_MODE:-auto}" == "prompt" ]]; then
  sudo -v
else
  if ! sudo -n true 2>/dev/null; then
    echo "sudo requires a password for ${USER}, but SUDO_MODE=auto avoids prompting." >&2
    echo "Fix options:" >&2
    echo "  - Re-run with: SUDO_MODE=prompt DEPLOY_HOST=... ./scripts/bootstrap-remote-server.sh" >&2
    echo "  - Or configure passwordless sudo (NOPASSWD) for ${USER} on the server." >&2
    echo "    Example (run as root):" >&2
    echo "      echo '${USER} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/${USER} && chmod 440 /etc/sudoers.d/${USER}" >&2
    exit 1
  fi
fi

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

step "2.6/7: Create deploy dir + clone repo (or reuse existing clone)"
sudo mkdir -p "${DEPLOY_DIR}"
sudo chown -R "${USER}:${USER}" "${DEPLOY_DIR}"
# Runtime configuration has a separate lifecycle from the checkout.
python3 - "$DEPLOY_DIR" "$DEPLOY_CONFIG_DIR" <<'PYCONFIG'
from pathlib import Path
import sys
repo, config = map(lambda x: Path(x).resolve(), sys.argv[1:])
if not Path(sys.argv[2]).is_absolute() or config == repo or repo in config.parents:
    raise SystemExit('DEPLOY_CONFIG_DIR must be absolute and outside DEPLOY_DIR')
PYCONFIG
sudo mkdir -p "$DEPLOY_CONFIG_DIR"
sudo chown "${USER}:${USER}" "$DEPLOY_CONFIG_DIR"
sudo chmod 700 "$DEPLOY_CONFIG_DIR"

cd "${DEPLOY_DIR}"
if [[ -d .git ]]; then
  echo "Repo already present at ${DEPLOY_DIR}."
else
  if [[ -n "$(ls -A 2>/dev/null)" ]]; then
    echo "${DEPLOY_DIR} is not empty and not a git repo; refusing to clone into it." >&2
    exit 1
  fi
  if [[ "${REPO_URL}" =~ ^git@github\.com: || "${REPO_URL}" =~ ^ssh://git@github\.com/ ]]; then
    mkdir -p "${HOME}/.ssh"
    chmod 700 "${HOME}/.ssh"
    touch "${HOME}/.ssh/known_hosts"
    chmod 600 "${HOME}/.ssh/known_hosts"
    if ! ssh-keygen -F github.com >/dev/null 2>&1; then
      echo "Adding github.com host key to ${HOME}/.ssh/known_hosts"
      if ! ssh-keyscan -H github.com >>"${HOME}/.ssh/known_hosts" 2>/dev/null; then
        echo "Failed to fetch github.com host key via ssh-keyscan." >&2
        exit 1
      fi
    fi
  fi
  export GIT_TERMINAL_PROMPT=0
  if ! git clone "${REPO_URL}" .; then
    echo "git clone failed for REPO_URL=${REPO_URL}" >&2
    echo "If this is a private GitHub repo, prefer SSH + agent forwarding from your laptop:" >&2
    echo "  REPO_URL=git@github.com:ORG/REPO.git SSH_FORWARD_AGENT=true DEPLOY_HOST=... ./scripts/bootstrap-remote-server.sh" >&2
    echo "Or configure a deploy key / PAT for the server." >&2
    exit 1
  fi
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
  log "📤 Step 3/4: Upload external private env files (no overwrite by default)"
  upload_private_file "$API_ENV_FILE" api
  upload_private_file "$MINIAPP_ENV_FILE" miniapp
else
  log "⏭️  Step 3/4: Skipping config upload (UPLOAD_CONFIG=false)"
fi

log "🔎 Step 4/4: Verify private configuration"
ssh_cmd "$DEPLOY_HOST" \
  "python3 '${DEPLOY_DIR}/scripts/private_env.py' check '${DEPLOY_CONFIG_DIR}/api.env' '${DEPLOY_CONFIG_DIR}/miniapp.env' --bots-dir '${DEPLOY_DIR}/deploy/bots' --deployment"

log "✅ Bootstrap complete. Next:"
echo "DEPLOY_HOST='${DEPLOY_HOST}' DEPLOY_DIR='${DEPLOY_DIR}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' DEPLOY_CONFIG_DIR='${DEPLOY_CONFIG_DIR}' ./scripts/deploy-remote.sh"
