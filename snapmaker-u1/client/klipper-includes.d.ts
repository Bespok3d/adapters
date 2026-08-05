// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
export interface Bespok3dInclude {
  pattern: string;
  line: string;
}
export declare const KLIPPER_INCLUDE: Bespok3dInclude;
export declare const MOONRAKER_INCLUDE: Bespok3dInclude;
export declare function bespok3dIncludeCommand(cfgPath: string, include: Bespok3dInclude): string;
