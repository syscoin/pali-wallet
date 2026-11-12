# Sourced by Git hooks from the repository root.
pali_required_node="v$(cat .nvmrc)"

# CI may already provide the pinned version through actions/setup-node.
if [ "$(node --version 2>/dev/null || true)" != "$pali_required_node" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "Pali Git hooks require Node $pali_required_node from .nvmrc." >&2
    return 1
  fi
  # A function passes --no-use to the sourced script in both dash and bash.
  pali_load_nvm() { . "$NVM_DIR/nvm.sh"; }
  pali_load_nvm --no-use || return 1
  unset -f pali_load_nvm
  nvm use || return 1
fi

if [ "$(node --version 2>/dev/null || true)" != "$pali_required_node" ]; then
  echo "Pali Git hooks require Node $pali_required_node from .nvmrc." >&2
  return 1
fi
unset pali_required_node
