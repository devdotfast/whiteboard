/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export interface ReviewLoopbackCert {
	readonly key: string;
	readonly cert: string;
	/** Electron's `Certificate.fingerprint` form: `sha256/<base64>`. */
	readonly fingerprint: string;
}

/** Chromium net error codes `setCertificateVerifyProc` takes: trust, or defer to Chromium. */
const TRUSTED = 0;
const CHROMIUM_VERDICT = -3;

const tlv = (tag: number, ...parts: Buffer[]): Buffer => {
	const body = Buffer.concat(parts);
	const n = body.length;
	const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
	return Buffer.concat([Buffer.from([tag, ...length]), body]);
};
const seq = (...parts: Buffer[]) => tlv(0x30, ...parts);
const oid = (hex: string) => tlv(0x06, Buffer.from(hex, 'hex'));
const utcTime = (date: Date) => tlv(0x17, Buffer.from(`${date.toISOString().slice(2, 19).replace(/[-:T]/g, '')}Z`));

/** A per-launch self-signed P-256 cert for 127.0.0.1. node:crypto cannot mint X.509, so this writes the DER. */
export function createReviewLoopbackCert(now = new Date()): ReviewLoopbackCert {
	const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
	const ecdsaSha256 = seq(oid('2a8648ce3d040302'));
	const name = seq(tlv(0x31, seq(oid('550403'), tlv(0x0c, Buffer.from('127.0.0.1')))));
	const serial = randomBytes(16);
	serial[0] = (serial[0] & 0x7f) | 0x01;
	const tbs = seq(
		tlv(0xa0, tlv(0x02, Buffer.from([2]))),
		tlv(0x02, serial),
		ecdsaSha256,
		name,
		seq(utcTime(new Date(now.getTime() - 60_000)), utcTime(new Date(now.getTime() + 7 * 86_400_000))),
		name,
		publicKey.export({ type: 'spki', format: 'der' }),
		tlv(0xa3, seq(seq(oid('551d11'), tlv(0x04, seq(tlv(0x87, Buffer.from([127, 0, 0, 1]))))))),
	);
	const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
	const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.from([0]), signature));
	const body = der.toString('base64').replace(/.{64}/g, '$&\n').replace(/\n$/, '');
	return {
		key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
		cert: `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`,
		fingerprint: `sha256/${createHash('sha256').update(der).digest('base64')}`,
	};
}

/** Trusts only this launch's cert on 127.0.0.1; every other host and cert keeps Chromium's own verdict. */
export function reviewLoopbackCertVerdict(
	request: { readonly hostname: string; readonly certificate: { readonly fingerprint: string } },
	fingerprint: string,
): number {
	return request.hostname === '127.0.0.1' && request.certificate.fingerprint === fingerprint ? TRUSTED : CHROMIUM_VERDICT;
}
