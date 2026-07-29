// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SshSession, EnrollContext } from '@adapter-sdk';
export declare function cleanSystemPython(ssh: SshSession): Promise<void>;
export declare function ensureVenv(ssh: SshSession, ctx: EnrollContext): Promise<void>;
export declare function installVenvDeps(ssh: SshSession, ctx: EnrollContext, src: string): Promise<void>;
