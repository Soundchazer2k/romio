// SPDX-License-Identifier: GPL-3.0
// Romio — Your retro library's best friend.

// Prevents additional console window on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    romio_lib::run();
}
