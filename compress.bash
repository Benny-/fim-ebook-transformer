#!/usr/bin/env bash

# This will make the script return a error if any sub-command returns a error
set -e

cd ${1}

7z a -mx9 -tzip "../processed.epub" *

