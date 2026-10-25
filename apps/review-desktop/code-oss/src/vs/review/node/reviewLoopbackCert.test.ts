/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { connect, createServer } from 'node:tls';
import test from 'node:test';

import { createReviewLoopbackCert, reviewLoopbackCertVerdict } from './reviewLoopbackCert.js';

test('a TLS client that trusts the cert reaches 127.0.0.1 with it', async (t) => {
	const { key, cert } = createReviewLoopbackCert();
	const server = createServer({ key, cert }, (socket) => socket.end('ok'));
	t.after(() => server.close());
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');

	const socket = connect({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, ca: cert });
	await once(socket, 'secureConnect');
	const [data] = await once(socket, 'data');
	socket.destroy();

	assert.equal(String(data), 'ok');
});

test('only this launch\'s cert on 127.0.0.1 is trusted; everything else keeps Chromium\'s verdict', () => {
	const { fingerprint } = createReviewLoopbackCert();
	const other = createReviewLoopbackCert().fingerprint;
	const verdict = (hostname: string, presented: string) => reviewLoopbackCertVerdict({ hostname, certificate: { fingerprint: presented } }, fingerprint);

	assert.equal(verdict('127.0.0.1', fingerprint), 0);
	assert.equal(verdict('127.0.0.1', other), -3);
	assert.equal(verdict('localhost', fingerprint), -3);
	assert.equal(verdict('example.com', fingerprint), -3);
});
