import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { webcrypto } from 'node:crypto';

// DiagnosticFlow calls crypto.randomUUID() at mount for the session id. jsdom does not
// provide WebCrypto, so back it with Node's implementation when it's missing.
if (!globalThis.crypto?.randomUUID) {
	// @ts-expect-error — assign Node's WebCrypto onto the (jsdom) global.
	globalThis.crypto = webcrypto;
}

afterEach(() => cleanup());
