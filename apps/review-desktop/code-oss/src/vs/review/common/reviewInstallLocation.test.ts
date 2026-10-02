/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewInstallLocation } from './reviewInstallLocation.js';

const out = 'Whiteboard.app/Contents/Resources/app/out';

test('classifies each place a macOS bundle can run from', () => {
	assert.equal(reviewInstallLocation(`/Applications/${out}`), 'applications');
	assert.equal(reviewInstallLocation(`/Users/ada/Applications/${out}`), 'user_applications');
	assert.equal(reviewInstallLocation(`/Volumes/Whiteboard/${out}`), 'volume');
	assert.equal(reviewInstallLocation(`/private/var/folders/x1/abc/T/AppTranslocation/0F2C-77/d/${out}`), 'translocated');
	assert.equal(reviewInstallLocation(`/Users/ada/Downloads/${out}`), 'other');
});

test('a translocated copy counts as translocated even when the original sat in Applications', () => {
	assert.equal(reviewInstallLocation(`/private/var/folders/x1/abc/T/AppTranslocation/0F2C-77/d/Applications/${out}`), 'translocated');
});

test('a folder that only resembles Applications is other', () => {
	assert.equal(reviewInstallLocation(`/Users/ada/Desktop/Applications/${out}`), 'other');
	assert.equal(reviewInstallLocation(`/ApplicationsOld/${out}`), 'other');
});
