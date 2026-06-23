import type { SshSession } from '@adapter-sdk';
export declare const OVERLAY_DEBUG_FLAG = "/oem/.debug";
export declare function writeLayerActive(ssh: SshSession): Promise<boolean>;
export declare function verifyEnrolled(ssh: SshSession): Promise<boolean>;
