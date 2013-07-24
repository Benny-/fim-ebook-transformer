#!/usr/bin/env bash

# This will make the script return a error if any sub-command returns a error
set -e

files=`echo "${1}/*.html"`
echo $files

tidy -utf8 -quiet -modify $files

