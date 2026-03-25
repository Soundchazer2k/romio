// SPDX-License-Identifier: GPL-3.0
// Mock for @tauri-apps/api/event used in Playwright tests.
// listen() returns a no-op unlisten function so components don't crash.

type EventCallback<T> = (event: { payload: T }) => void;

export async function listen<T>(
  _event: string,
  _handler: EventCallback<T>
): Promise<() => void> {
  // Return a no-op unlisten function
  return () => {};
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {
  // No-op in test mode
}
