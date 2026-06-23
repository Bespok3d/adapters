import type { SshSession } from '@adapter-sdk';
export declare function daemonFiles(srcBase: string, prefix?: string): string[];
export declare function jinniFiles(srcBase: string, prefix?: string): string[];
export declare function daemonModuleDirs(files: string[]): string[];
export declare function uploadDaemonFile(ssh: SshSession, srcBase: string, file: string): Promise<void>;
