import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { webcrypto } from 'node:crypto';

// DiagnosticFlow calls crypto.randomUUID() at mount for the session id. jsdom does not
// provide WebCrypto, so back it with Node's implementation when it's missing.
if (!globalThis.crypto?.randomUUID) {
	// @ts-expect-error — assign Node's WebCrypto onto the (jsdom) global.
	globalThis.crypto = webcrypto;
}

// Analytics beacons fire on mount (PRD §11). Give jsdom a no-op fetch so flow tests never
// touch the network; individual tests override it with vi.stubGlobal when they assert on it.
if (!globalThis.fetch) {
	globalThis.fetch = (() => Promise.resolve(new Response('{}'))) as typeof fetch;
}

afterEach(() => cleanup());
