// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SshSession } from '@adapter-sdk';
interface Acl {
    keys: string[];
    roles: Record<string, string>;
    labels: Record<string, string>;
    tokens: string[];
    token_identity: Record<string, string>;
}
export declare function readAcl(ssh: SshSession): Promise<Acl>;
export declare function grantedAcl(existing: Acl, identity: string, token: string, role: string, label: string): Acl;
export {};
