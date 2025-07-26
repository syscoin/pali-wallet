#!/bin/bash

# Build all sysweb3 packages
echo "Building sysweb3 packages..."

(cd ../sysweb3/packages/sysweb3-core && yarn localTest)
(cd ../sysweb3/packages/sysweb3-network && yarn localTest)
(cd ../sysweb3/packages/sysweb3-utils && yarn localTest)
(cd ../sysweb3/packages/sysweb3-keyring && yarn localTest)

echo "All packages built successfully!"

echo "Setting up inter-package dependencies in dist directories..."

# Create node_modules in dist directories for inter-package dependency resolution
mkdir -p ../sysweb3/packages/sysweb3-keyring/dist/node_modules/@sidhujag
ln -sf ../../../../sysweb3-core/dist ../sysweb3/packages/sysweb3-keyring/dist/node_modules/@sidhujag/sysweb3-core
ln -sf ../../../../sysweb3-network/dist ../sysweb3/packages/sysweb3-keyring/dist/node_modules/@sidhujag/sysweb3-network
ln -sf ../../../../sysweb3-utils/dist ../sysweb3/packages/sysweb3-keyring/dist/node_modules/@sidhujag/sysweb3-utils

mkdir -p ../sysweb3/packages/sysweb3-utils/dist/node_modules/@sidhujag
ln -sf ../../../../sysweb3-network/dist ../sysweb3/packages/sysweb3-utils/dist/node_modules/@sidhujag/sysweb3-network

echo "Linking packages to Pali wallet..."

# Remove any existing @sidhujag packages (npm installed or previous symlinks)
rm -rf node_modules/@sidhujag

# Create @sidhujag directory if it doesn't exist
mkdir -p node_modules/@sidhujag

# Create clean symlinks to dist directories (replace npm packages entirely)
ln -sf ../../../sysweb3/packages/sysweb3-core/dist node_modules/@sidhujag/sysweb3-core
ln -sf ../../../sysweb3/packages/sysweb3-network/dist node_modules/@sidhujag/sysweb3-network
ln -sf ../../../sysweb3/packages/sysweb3-utils/dist node_modules/@sidhujag/sysweb3-utils
ln -sf ../../../sysweb3/packages/sysweb3-keyring/dist node_modules/@sidhujag/sysweb3-keyring


echo "Packages linked successfully!"
echo "Start Pali wallet with: yarn dev:chrome" 