#!/usr/bin/env bash

# This will make the script return a error if any sub-command returns a error
set -e

cd ${1}

# The mimetype must be the first element in the zip. epub specs.
zip -X   "../processed.epub" mimetype
zip -Xrg "../processed.epub" META-INF
zip -Xrg "../processed.epub" .

