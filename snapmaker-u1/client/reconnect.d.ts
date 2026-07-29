// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { EnrollContext } from '@adapter-sdk';
export declare function pollReconnect(ctx: EnrollContext, hostname: string, start?: number, hintSent?: boolean): Promise<void>;
