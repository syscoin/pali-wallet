#!/bin/bash

# Configs
REPO_OWNER="syscoin"
REPO_NAME="pali-wallet"
BRANCH="develop"
VAULT_FILE_PATH="source/state/vault/index.ts"
CONTROLLER_FILE_PATH="source/scripts/Background/controllers/index.ts"


VAULT_FILE_URL="https://raw.githubusercontent.com/$REPO_OWNER/$REPO_NAME/$BRANCH/$VAULT_FILE_PATH"


TEMP_VAULT_FILE=$(mktemp)
curl -s -o $TEMP_VAULT_FILE $VAULT_FILE_URL

extract_vault_states() {
  awk '
  /export const initialState/ {flag=1; next}
  /^\};/ {flag=0}
  flag && /^[[:space:]]*[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*:/ {
    sub(/:.*/, "", $1); print $1
  }
  ' $1 | sed 's/[[:space:]]//g'
}

LOCAL_VAULT_STATES=$(extract_vault_states $VAULT_FILE_PATH)

REMOTE_VAULT_STATES=$(extract_vault_states $TEMP_VAULT_FILE)

IFS=$'\n' read -r -d '' -a LOCAL_VAULT_STATES_ARRAY <<< "$LOCAL_VAULT_STATES"
IFS=$'\n' read -r -d '' -a REMOTE_VAULT_STATES_ARRAY <<< "$REMOTE_VAULT_STATES"

new_states=$(echo ${LOCAL_VAULT_STATES_ARRAY[@]} ${REMOTE_VAULT_STATES_ARRAY[@]} | tr ' ' '\n' | sort | uniq -u)

if [ -z "$new_states" ]; then
  echo "No new states detected."
  rm $TEMP_VAULT_FILE
  exit 0
fi

missing_states=()
for state in $new_states; do
  if ! grep -qw "$state" $CONTROLLER_FILE_PATH; then
    missing_states+=("$state")
  fi
done

if [ ${#missing_states[@]} -ne 0 ]; then
  echo "The following new states from the vault in develop are missing in the controller:"
  for state in "${missing_states[@]}"; do
    echo "State: $state"
  done
  rm $TEMP_VAULT_FILE
  exit 1
else
  echo "All new states from the vault in develop are reflected in the controller."
fi

rm $TEMP_VAULT_FILE
