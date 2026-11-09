// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SshSession, EnrollContext } from '@adapter-sdk';
import type { PayloadSource } from './package-deploy';
export declare function openJinniSource(): Promise<PayloadSource>;
export declare function uploadAdapterJinni(ssh: SshSession, ctx: EnrollContext): Promise<void>;
