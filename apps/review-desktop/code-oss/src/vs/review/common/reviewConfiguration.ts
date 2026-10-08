/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Registers Review's configuration with the workbench.
 *
 * Importing this module pulls in the configuration registry, which constructs
 * itself — and localizes — at module scope. That makes it unsafe anywhere the
 * Electron main process can reach before `bootstrapESM()`; see the header of
 * `reviewConfigurationDefaults.ts`. Renderer code reaches it through the bare
 * side-effect import in `review.common.main.ts`.
 *
 * The setting keys and default values live in `reviewConfigurationDefaults.ts`
 * and are deliberately *not* re-exported from here: a re-export would let a
 * main-process consumer import data through this module and put the registry
 * back on its import path.
 */
import { localize } from '../../nls.js';
import { Registry } from '../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions, type IConfigurationRegistry } from '../../platform/configuration/common/configurationRegistry.js';
import { REVIEW_CTRL_TAB_CHOICES, REVIEW_CTRL_TAB_SETTING, REVIEW_DOCUMENT_WIDTH_CHOICES, REVIEW_DOCUMENT_WIDTH_SETTING, REVIEW_KEYMAPS, REVIEW_KEYMAP_SETTING, REVIEW_READY_NOTIFICATION_CHOICES, REVIEW_READY_NOTIFICATION_SETTING, REVIEW_REMOTE_HOSTS_ENABLED_SETTING, REVIEW_REMOTE_HOSTS_SETTING, REVIEW_REMOTE_INSTALL_MODES, REVIEW_REMOTE_INSTALL_SETTING, REVIEW_SOFTWARE_MAP_SETTING, REVIEW_STRUCTURAL_DIFF_SETTING, REVIEW_TELEMETRY_SETTING, curatedExtensionConfigurationDefaults, reviewConfigurationDefaults } from './reviewConfigurationDefaults.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'review',
	title: localize('reviewConfigurationTitle', "Whiteboard"),
	type: 'object',
	scope: ConfigurationScope.APPLICATION,
	properties: {
		[REVIEW_KEYMAP_SETTING]: {
			type: 'string',
			enum: [...REVIEW_KEYMAPS],
			default: 'none',
			description: localize('review.keymap', "Select the curated keymap extension Whiteboard enables."),
		},
		[REVIEW_CTRL_TAB_SETTING]: {
			type: 'string',
			enum: [...REVIEW_CTRL_TAB_CHOICES],
			enumDescriptions: [
				localize('review.tabs.ctrlTab.recent', "Switch to the last used tab. Press again to switch back."),
				localize('review.tabs.ctrlTab.next', "Switch to the next tab in the tab bar. Ctrl+Shift+Tab switches to the previous one."),
			],
			default: 'recent',
			description: localize('review.tabs.ctrlTab', "What Ctrl+Tab does."),
		},
		[REVIEW_DOCUMENT_WIDTH_SETTING]: {
			type: 'string',
			enum: [...REVIEW_DOCUMENT_WIDTH_CHOICES],
			enumDescriptions: [
				localize('review.documentWidth.standard', "A reading-width column."),
				localize('review.documentWidth.wide', "More room for diagrams and code."),
				localize('review.documentWidth.full', "Diagrams and code use the full width; text keeps a reading measure."),
			],
			default: 'standard',
			description: localize('review.documentWidth', "Width of the whiteboard document."),
		},
		[REVIEW_READY_NOTIFICATION_SETTING]: {
			type: 'string',
			enum: [...REVIEW_READY_NOTIFICATION_CHOICES],
			enumDescriptions: [
				localize('review.notifications.reviewReady.notificationAndBadge', "Show a notification and badge the Dock icon."),
				localize('review.notifications.reviewReady.notification', "Show a notification only."),
				localize('review.notifications.reviewReady.off', "Don't notify."),
			],
			default: 'off',
			description: localize('review.notifications.reviewReady', "How Whiteboard tells you an agent finished a review."),
		},
		[REVIEW_TELEMETRY_SETTING]: {
			type: 'boolean',
			default: true,
			description: localize('review.telemetry.enabled', "Send anonymous Whiteboard usage data."),
		},
		[REVIEW_STRUCTURAL_DIFF_SETTING]: {
			type: 'boolean',
			default: true,
			description: localize('review.experimental.structuralDiff.enabled', "Replace the standard diff view with structural diffs from diffr."),
		},
		[REVIEW_SOFTWARE_MAP_SETTING]: {
			type: 'boolean',
			default: false,
			description: localize('review.experimental.softwareMap.enabled', "Show the experimental Software Map view in sessions."),
		},
		[REVIEW_REMOTE_HOSTS_SETTING]: {
			type: 'array',
			items: { type: 'string' },
			default: [],
			scope: ConfigurationScope.APPLICATION,
			description: localize('review.remote.hosts', "SSH host aliases, from your SSH configuration, whose Whiteboard reviews to show."),
		},
		[REVIEW_REMOTE_HOSTS_ENABLED_SETTING]: {
			type: 'boolean',
			default: false,
			description: localize('review.experimental.remoteHosts.enabled', "Connect over SSH to the hosts in `review.remote.hosts`."),
		},
		[REVIEW_REMOTE_INSTALL_SETTING]: {
			type: 'string',
			enum: [...REVIEW_REMOTE_INSTALL_MODES],
			enumDescriptions: [
				localize('review.remote.install.ask', "Ask once per host before installing."),
				localize('review.remote.install.always', "Install without asking."),
				localize('review.remote.install.never', "Never install; use the Whiteboard you installed on the host."),
			],
			default: 'ask',
			scope: ConfigurationScope.APPLICATION,
			description: localize('review.remote.install', "Whether Whiteboard installs its own version on a remote host, under ~/.dev/whiteboard-remote, when the host does not have it."),
		},
	},
});

configurationRegistry.registerDefaultConfigurations([
	{ overrides: reviewConfigurationDefaults },
	{ overrides: curatedExtensionConfigurationDefaults }
]);
