#!/bin/bash

SYSROOT=/home/petschekr/cross-compile

export PKG_CONFIG_DIR=
export PKG_CONFIG_LIBDIR=${SYSROOT}/usr/lib/arm-linux-gnueabihf/pkgconfig
export PKG_CONFIG_SYSROOT_DIR=${SYSROOT}
export PKG_CONFIG_ALLOW_CROSS=1

export RUSTFLAGS="-ludev"

cargo build --target=armv7-unknown-linux-gnueabihf --features vendored "$@"
