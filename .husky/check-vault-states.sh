#!/bin/bash

# Configuração
REPO_OWNER="syscoin"
REPO_NAME="pali-wallet"
BRANCH="develop"
VAULT_FILE_PATH="source/state/vault/index.ts"
CONTROLLER_FILE_PATH="source/scripts/Background/controllers/index.ts"

# Obter o arquivo vault da branch develop usando a API do GitHub
VAULT_FILE_URL="https://raw.githubusercontent.com/$REPO_OWNER/$REPO_NAME/$BRANCH/$VAULT_FILE_PATH"

# Baixar o arquivo vault remoto para um local temporário
TEMP_VAULT_FILE=$(mktemp)
curl -s -o $TEMP_VAULT_FILE $VAULT_FILE_URL

# Função para extrair estados de nível superior do objeto initialState em um arquivo
extract_vault_states() {
  awk '
  /export const initialState/ {flag=1; next}
  /^\};/ {flag=0}
  flag && /^[[:space:]]*[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*:/ {
    sub(/:.*/, "", $1); print $1
  }
  ' $1 | sed 's/[[:space:]]//g'
}

# Extrair estados do arquivo vault local
LOCAL_VAULT_STATES=$(extract_vault_states $VAULT_FILE_PATH)

# Extrair estados do arquivo vault remoto
REMOTE_VAULT_STATES=$(extract_vault_states $TEMP_VAULT_FILE)

# Converter strings em arrays
IFS=$'\n' read -r -d '' -a LOCAL_VAULT_STATES_ARRAY <<< "$LOCAL_VAULT_STATES"
IFS=$'\n' read -r -d '' -a REMOTE_VAULT_STATES_ARRAY <<< "$REMOTE_VAULT_STATES"

# Debugging: imprimir estados extraídos
echo "Local states: ${LOCAL_VAULT_STATES_ARRAY[@]}"
echo "Remote states: ${REMOTE_VAULT_STATES_ARRAY[@]}"

# Comparar os estados
new_states=$(echo ${LOCAL_VAULT_STATES_ARRAY[@]} ${REMOTE_VAULT_STATES_ARRAY[@]} | tr ' ' '\n' | sort | uniq -u)

# Imprimir novos estados (para fins de depuração)
echo "New states detected: $new_states"

# Verificar se os novos estados estão no controller
missing_states=()
for state in $new_states; do
  if ! grep -qw "$state" $CONTROLLER_FILE_PATH; then
    missing_states+=("$state")
  fi
done

# Exibir os resultados e retornar código de saída 1 se houver estados ausentes
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

# Limpar o arquivo temporário
rm $TEMP_VAULT_FILE
