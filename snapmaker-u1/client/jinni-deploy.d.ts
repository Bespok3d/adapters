// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SshSession, EnrollContext } from '@adapter-sdk';
import type { ProgressSpan } from './step-progress';
export declare function uploadAdapterJinni(ssh: SshSession, ctx: EnrollContext, progressSpan?: ProgressSpan): Promise<void>;
